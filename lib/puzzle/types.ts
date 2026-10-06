export type Bit = 0 | 1
export type Cell = Bit | null
export type Constraint =
  | { kind: "no-three"; cells: readonly [number, number, number] }
  | { kind: "quota"; cells: readonly number[]; ones: number }
  | { kind: "friend"; cells: readonly [number, number]; relation: "=" | "×" }

export type RulePack = {
  seed: number
  n: 4 | 5 | 6
  mode: "FORCED-CHAIN"
  rulesPostcard: readonly string[]
  cells: readonly Cell[]
  constraints: readonly Constraint[]
  verifierSpec: { version: 1; alphabet: readonly [0, 1]; empty: null }
}

export type Player = "human" | "learner"
export type Action =
  | { type: "selectCell"; cell: number }
  | { type: "cycle" }
  | { type: "undo" }
  | { type: "clear" }
export type PlayerStatus = "playing" | "finished" | "action-cap" | "time-cap"

// This is the entire L0 capability boundary. No pack, constraints, or verifier.
export type Observation = {
  seed: number
  n: number
  mode: "FORCED-CHAIN"
  rulesPostcard: readonly string[]
  cells: readonly Cell[]
  given: readonly boolean[]
  selectedCell: number | null
  actions: number
  remainingActions: number
  remainingMs: number
  status: PlayerStatus
}

export type ActionAPI = {
  selectCell: (cell: number) => void
  cycle: () => void
  undo: () => void
  clear: () => void
}

export type RoundRecord = {
  seed: number
  n: number
  transferGroup: string
  editableCells: number
  player: Player
  actions: number
  status: Exclude<PlayerStatus, "playing">
  patternClaim: string | null
}
