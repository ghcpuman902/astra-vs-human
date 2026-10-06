import type { Cell, Constraint, RulePack } from "./types"

export function constraintPossible(
  rule: Constraint,
  cells: readonly Cell[]
): boolean {
  const values = rule.cells.map((index) => cells[index])
  if (rule.kind === "quota") {
    const ones = values.filter((value) => value === 1).length
    const empty = values.filter((value) => value === null).length
    return ones <= rule.ones && ones + empty >= rule.ones
  }
  if (values.includes(null)) return true
  if (rule.kind === "no-three")
    return !(values[0] === values[1] && values[1] === values[2])
  return (values[0] === values[1]) === (rule.relation === "=")
}

export function packErrors(pack: RulePack): string[] {
  const errors: string[] = []
  if (![4, 5, 6].includes(pack.n) || pack.cells.length !== pack.n ** 2)
    errors.push("Invalid grid size")
  if (!Number.isSafeInteger(pack.seed) || pack.mode !== "FORCED-CHAIN")
    errors.push("Invalid pack identity")
  if (
    pack.verifierSpec.version !== 1 ||
    pack.verifierSpec.empty !== null ||
    pack.verifierSpec.alphabet.join(",") !== "0,1"
  )
    errors.push("Unsupported verifier specification")
  if (
    Array.from(pack.cells).some(
      (value) => value !== null && value !== 0 && value !== 1
    )
  )
    errors.push("Invalid cell")
  for (const rule of pack.constraints) {
    if (
      new Set(rule.cells).size !== rule.cells.length ||
      rule.cells.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= pack.cells.length
      )
    )
      errors.push("Invalid constraint coordinates")
    if (
      rule.kind === "quota" &&
      (!Number.isInteger(rule.ones) ||
        rule.ones < 0 ||
        rule.ones > rule.cells.length)
    )
      errors.push("Invalid quota")
    if (rule.kind === "no-three" && rule.cells.length !== 3)
      errors.push("Invalid triple")
    if (
      rule.kind === "friend" &&
      (rule.cells.length !== 2 || !["=", "×"].includes(rule.relation))
    )
      errors.push("Invalid friend")
  }
  return errors
}

/** Pure host verifier. Partial validity means no currently broken constraint, not solvability. */
export function verify(pack: RulePack, cells: readonly Cell[]) {
  const errors = packErrors(pack)
  if (
    cells.length !== pack.cells.length ||
    Array.from(cells).some(
      (value) => value !== null && value !== 0 && value !== 1
    )
  )
    errors.push("Invalid board")
  if (errors.length)
    return { valid: false, complete: false, errors, violations: [] as number[] }
  const changedGiven = pack.cells.some(
    (value, index) => value !== null && value !== cells[index]
  )
  if (changedGiven) errors.push("A given was changed")
  const violations = pack.constraints.flatMap((rule, index) =>
    constraintPossible(rule, cells) ? [] : [index]
  )
  const valid = !errors.length && !violations.length
  return { valid, complete: valid && !cells.includes(null), errors, violations }
}
