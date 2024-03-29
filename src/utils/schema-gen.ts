import {
  ExpressionContext,
  PluginError,
  getAttributeArg,
  getAttributeArgLiteral,
  getLiteral,
} from "@zenstackhq/sdk"
import {
  DataModel,
  DataModelField,
  DataModelFieldAttribute,
  isDataModel,
  isEnum,
  isInvocationExpr,
  isNumberLiteral,
  isStringLiteral,
} from "@zenstackhq/sdk/ast"
import { upperCaseFirst } from "upper-case-first"
import { name } from ".."
import {
  TypeScriptExpressionTransformer,
  TypeScriptExpressionTransformerError,
} from "./typescript-expression-transformer"
import { isFromStdlib } from "./is-std-lib"

export function makeFieldSchema(field: DataModelField, respectDefault = false) {
  if (isDataModel(field.type.reference?.ref)) {
    if (field.type.array) {
      // array field is always optional
      return `z.array(z.unknown()).optional()`
    } else {
      return field.type.optional
        ? `z.record(z.unknown()).optional()`
        : `z.record(z.unknown())`
    }
  }

  let schema = makeZodSchema(field)
  const isDecimal = field.type.type === "Decimal"

  for (const attr of field.attributes) {
    const message = getAttrLiteralArg<string>(attr, "message")
    const messageArg = message
      ? `, { message: ${JSON.stringify(message)} }`
      : ""
    const messageArgFirst = message
      ? `{ message: ${JSON.stringify(message)} }`
      : ""

    switch (attr.decl.ref?.name) {
      case "@vLength": {
        const min = getAttrLiteralArg<number>(attr, "min")
        if (min) {
          schema += `.min(${min}${messageArg})`
        }
        const max = getAttrLiteralArg<number>(attr, "max")
        if (max) {
          schema += `.max(${max}${messageArg})`
        }
        break
      }
      case "@vContains": {
        const expr = getAttrLiteralArg<string>(attr, "text")
        if (expr) {
          schema += `.includes(${JSON.stringify(expr)}${messageArg})`
        }
        break
      }
      case "@vRegex": {
        const expr = getAttrLiteralArg<string>(attr, "regex")
        if (expr) {
          schema += `.regex(new RegExp(${JSON.stringify(expr)})${messageArg})`
        }
        break
      }
      case "@vStartsWith": {
        const text = getAttrLiteralArg<string>(attr, "text")
        if (text) {
          schema += `.startsWith(${JSON.stringify(text)}${messageArg})`
        }
        break
      }
      case "@vEndsWith": {
        const text = getAttrLiteralArg<string>(attr, "text")
        if (text) {
          schema += `.endsWith(${JSON.stringify(text)}${messageArg})`
        }
        break
      }
      case "@vEmail": {
        schema += `.email(${messageArgFirst})`
        break
      }
      case "@vUrl": {
        schema += `.url(${messageArgFirst})`
        break
      }
      case "@vTrim": {
        schema += `.trim()`
        break
      }
      case "@vLower": {
        schema += `.toLowerCase()`
        break
      }
      case "@vUpper": {
        schema += `.toUpperCase()`
        break
      }
      case "@vDatetime": {
        schema += `.datetime({ offset: true${message ? ", message: " + JSON.stringify(message) : ""} })`
        break
      }
      case "@vGt": {
        const value = getAttrLiteralArg<number>(attr, "value")
        if (value !== undefined) {
          schema += isDecimal
            ? refineDecimal("gt", value, messageArg)
            : `.gt(${value}${messageArg})`
        }
        break
      }
      case "@vGte": {
        const value = getAttrLiteralArg<number>(attr, "value")
        if (value !== undefined) {
          schema += isDecimal
            ? refineDecimal("gte", value, messageArg)
            : `.gte(${value}${messageArg})`
        }
        break
      }
      case "@vLt": {
        const value = getAttrLiteralArg<number>(attr, "value")
        if (value !== undefined) {
          schema += isDecimal
            ? refineDecimal("lt", value, messageArg)
            : `.lt(${value}${messageArg})`
        }
        break
      }
      case "@vLte": {
        const value = getAttrLiteralArg<number>(attr, "value")
        if (value !== undefined) {
          schema += isDecimal
            ? refineDecimal("lte", value, messageArg)
            : `.lte(${value}${messageArg})`
        }
        break
      }
    }
  }

  if (respectDefault) {
    const schemaDefault = getFieldSchemaDefault(field)
    if (schemaDefault) {
      schema += `.default(${schemaDefault})`
    }
  }

  if (field.type.optional) {
    schema += ".nullish()"
  }

  return schema
}

function makeZodSchema(field: DataModelField) {
  let schema: string

  if (field.type.reference?.ref && isEnum(field.type.reference?.ref)) {
    schema = `${upperCaseFirst(field.type.reference.ref.name)}Schema`
  } else {
    switch (field.type.type) {
      case "Int":
      case "Float":
        schema = "z.number()"
        break
      case "Decimal":
        schema = "DecimalSchema"
        break
      case "BigInt":
        schema = "z.bigint()"
        break
      case "String":
        schema = "z.string()"
        break
      case "Boolean":
        schema = "z.boolean()"
        break
      case "DateTime":
        schema = "z.date()"
        break
      case "Bytes":
        schema = "z.union([z.string(), z.instanceof(Uint8Array)])"
        break
      default:
        schema = "z.any()"
        break
    }
  }

  if (field.type.array) {
    schema = `z.array(${schema})`
  }

  return schema
}

export function makeValidationRefinements(model: DataModel) {
  const attrs = model.attributes.filter((attr) => attr.decl.ref?.name === "@@v")
  const importedConstants: Set<string> = new Set()
  const importedLodashFunctions: Set<string> = new Set()
  const refinements = attrs
    .map((attr) => {
      const valueArg = getAttributeArg(attr, "value")
      if (!valueArg) {
        return undefined
      }

      const messageArg = getAttributeArgLiteral<string>(attr, "message")
      const message = messageArg
        ? `, { message: ${JSON.stringify(messageArg)} }`
        : ""

      try {
        const expressionTransformer = new TypeScriptExpressionTransformer({
          context: ExpressionContext.ValidationRule,
          fieldReferenceContext: "value",
        })
        const expr = expressionTransformer.transform(valueArg)
        expressionTransformer.importedConstants.forEach((name) =>
          importedConstants.add(name)
        )
        expressionTransformer.importedLodashFunctions.forEach((name) =>
          importedLodashFunctions.add(name)
        )
        return `.refine((value: any) => ${expr}${message})`
      } catch (err) {
        if (err instanceof TypeScriptExpressionTransformerError) {
          throw new PluginError(name, err.message)
        } else {
          throw err
        }
      }
    })
    .filter((r) => !!r)

  return { refinements, importedConstants, importedLodashFunctions }
}

function getAttrLiteralArg<T extends string | number>(
  attr: DataModelFieldAttribute,
  paramName: string
) {
  const arg = attr.args.find((arg) => arg.$resolvedParam?.name === paramName)
  return arg && getLiteral<T>(arg.value)
}

function refineDecimal(
  op: "gt" | "gte" | "lt" | "lte",
  value: number,
  messageArg: string
) {
  return `.refine(v => {
        try {
            return new Decimal(v.toString()).${op}(${value});
        } catch {
            return false;
        }
    }${messageArg})`
}

export function getFieldSchemaDefault(field: DataModelField) {
  const attr = field.attributes.find(
    (attr) => attr.decl.ref?.name === "@default"
  )
  if (!attr) {
    return undefined
  }
  const arg = attr.args.find((arg) => arg.$resolvedParam?.name === "value")
  if (arg) {
    if (isStringLiteral(arg.value)) {
      return JSON.stringify(arg.value.value)
    } else if (isNumberLiteral(arg.value)) {
      return arg.value.value
    } else if (
      isInvocationExpr(arg.value) &&
      isFromStdlib(arg.value.function.ref!) &&
      arg.value.function.$refText === "now"
    ) {
      return `() => new Date()`
    }
  }

  return undefined
}
