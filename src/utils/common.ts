import { DataModel, Model } from "@zenstackhq/sdk/ast"

export function hasConstantVariable(model: DataModel): Boolean {
  return Boolean(
    model &&
      model.attributes.find((at) => at?.decl?.$refText === "@@defineConstant")
  )
}

export function isIgnoreModel(model: DataModel): Boolean {
  return Boolean(
    model && model.attributes.find((at) => at?.decl?.$refText === "@@ignore")
  )
}

export function getIgnoreModels(models: DataModel[]) {
  return models
    .filter((model) => isIgnoreModel(model))
    .map((model) => model.name)
}
