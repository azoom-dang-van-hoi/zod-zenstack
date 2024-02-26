import { AstNode, isModel, Model } from "@zenstackhq/language/ast"

export function getContainingModel(node: AstNode | undefined): Model | null {
  if (!node) {
    return null
  }
  return isModel(node) ? node : getContainingModel(node.$container)
}

export function isFromStdlib(node: AstNode) {
  const model = getContainingModel(node)
  return !!model && !!model.$document
}
