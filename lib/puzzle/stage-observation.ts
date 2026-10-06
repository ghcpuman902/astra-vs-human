import type { MatchSnapshot } from "./match"
import type { Observation, Player, RulePack } from "./types"

/** Structural bridge for the authoritative Lovable stage; no UI implementation. */
export type PublicStage = {
  match: {
    getSnapshot: () => Pick<MatchSnapshot, "seed" | "remainingMs" | "players">
  }
  started: () => boolean
  ended: () => boolean
}

/** Pass exactly the quota/friend marks that the shell renders for both players. */
export function observeStage(
  stage: PublicStage,
  pack: RulePack,
  publicMarks: NonNullable<Observation["publicMarks"]>,
  player: Player = "learner"
): Observation {
  const snapshot = stage.match.getSnapshot()
  if (snapshot.seed !== pack.seed)
    throw new Error("Stage and pack seeds differ")
  const state = snapshot.players[player]
  const active = stage.started() && !stage.ended()
  return {
    seed: pack.seed,
    n: pack.n,
    mode: pack.mode,
    rulesPostcard: [...pack.rulesPostcard],
    publicMarks: structuredClone(publicMarks),
    cells: [...state.cells],
    given: pack.cells.map((cell) => cell !== null),
    selectedCell: state.selectedCell,
    actions: state.actions,
    // The supplied demo uses a time cap with effectively unlimited attempts.
    remainingActions: Math.max(0, 1_000_000 - state.actions),
    remainingMs: active
      ? Math.max(0, Math.min(600_000, snapshot.remainingMs))
      : 0,
    status: stage.ended() ? "time-cap" : state.status,
  }
}

export function displayedMarks(
  n: number,
  clues: {
    quotas: readonly { axis: "row" | "column"; line: number; target: number }[]
    friends: readonly {
      cells: readonly [number, number]
      relation: "=" | "×"
    }[]
  }
): NonNullable<Observation["publicMarks"]> {
  return {
    quotas: clues.quotas.map((clue) => ({
      cells: Array.from({ length: n }, (_, offset) =>
        clue.axis === "row" ? clue.line * n + offset : offset * n + clue.line
      ),
      count: clue.target,
    })),
    friends: clues.friends.map((clue) => ({
      cells: [...clue.cells] as [number, number],
      relation: clue.relation,
    })),
  }
}
