import {
  applyGameAction,
  initialGameState,
  type GameState,
} from "../mini-game-rules/runtime"
import {
  packSchema,
  type GameAction,
  type GamePack,
} from "../mini-game-rules/schema"
import { verifyGame } from "../mini-game-rules/verifier"

export type Side = "human" | "learner"
export type RoundStatus = "playing" | "finished" | "action-cap" | "time-cap"
export type SharedActions = {
  selectCell: (cell: number) => void
  cycle: () => void
  undo: () => void
  clear: () => void
}
export type Attempt = {
  state: GameState
  status: RoundStatus
  endedAtMs: number | null
  claim: string | null
}
export type BattleRecord = {
  seed: number
  side: Side
  transferGroup: string
  status: Exclude<RoundStatus, "playing">
  actions: number
  elapsedMs: number
  claim: string | null
}
export type BattleSnapshot = {
  round: number
  seed: number
  remainingMs: number
  intendedSeconds: number
  attempts: Record<Side, Attempt>
  canAdvance: boolean
  hasNext: boolean
  records: readonly BattleRecord[]
}
export type BoardProps = {
  seed: number
  n: number
  category: GamePack["category"]
  mode: GamePack["mode"]
  postcard: GamePack["postcard"]
  clues: GamePack["rules"]
  actionSurface: GamePack["actionSurface"]
  cells: {
    index: number
    row: number
    column: number
    value: number | null
    locked: boolean
    visible: boolean
    selected: boolean
  }[]
  actions: number
  remainingActions: number
  remainingMs: number
  status: RoundStatus
  readOnly: boolean
  hints: "practice-only"
}
export type BattleOptions = {
  actionCap?: number
  timeCapMs?: number
  practice?: boolean
  startPaused?: boolean
  now?: () => number
}

/** Hackathon session/chrome bridge. Durable rule packs contain no tabs or craft tokens. */
export function createBattleGround(
  input: readonly GamePack[],
  options: BattleOptions = {}
) {
  if (
    !input.length ||
    new Set(input.map((pack) => pack.seed)).size !== input.length
  )
    throw new Error("Supply distinct round seeds")
  const packs = input.map((pack) => packSchema.parse(structuredClone(pack)))
  const actionCap = options.actionCap ?? 300
  // 10–120s is the intended session length. A stuck player gets a 10min shared cap.
  const timeCapMs = options.timeCapMs ?? 600_000
  if (
    !Number.isInteger(actionCap) ||
    actionCap <= 0 ||
    !Number.isFinite(timeCapMs) ||
    timeCapMs <= 0
  )
    throw new Error("Invalid caps")
  const now = options.now ?? (() => performance.now())
  const listeners = new Set<() => void>()
  let round = 0
  let started = now()
  let running = !options.startPaused
  let records: BattleRecord[] = []
  const fresh = (): Attempt => ({
    state: initialGameState(packs[round]),
    status: "playing",
    endedAtMs: null,
    claim: null,
  })
  let attempts: Record<Side, Attempt> = { human: fresh(), learner: fresh() }
  let snapshot: BattleSnapshot
  const remaining = () => {
    if (!running) return timeCapMs
    const elapsed =
      attempts.human.status !== "playing" &&
      attempts.learner.status !== "playing"
        ? Math.max(
            attempts.human.endedAtMs ?? 0,
            attempts.learner.endedAtMs ?? 0
          )
        : now() - started
    return Math.max(0, timeCapMs - elapsed)
  }
  const bothEnded = () =>
    attempts.human.status !== "playing" && attempts.learner.status !== "playing"
  const publish = () => {
    snapshot = freeze({
      round,
      seed: packs[round].seed,
      remainingMs: remaining(),
      intendedSeconds: packs[round].session.targetSeconds,
      attempts,
      canAdvance: bothEnded() && round + 1 < packs.length,
      hasNext: round + 1 < packs.length,
      records,
    })
    listeners.forEach((listener) => listener())
  }
  const record = (side: Side) => {
    const attempt = attempts[side]
    if (attempt.status === "playing") return
    const pack = packs[round]
    records = [
      ...records,
      {
        seed: pack.seed,
        side,
        transferGroup: [
          pack.category,
          pack.n,
          pack.mode,
          pack.visibility.kind,
          pack.transfer.family,
        ].join(":"),
        status: attempt.status,
        actions: attempt.state.actions,
        elapsedMs: attempt.endedAtMs ?? now() - started,
        claim: attempt.claim,
      },
    ]
  }
  const tick = () => {
    if (running && remaining() === 0)
      for (const side of ["human", "learner"] as const) {
        if (attempts[side].status !== "playing") continue
        attempts = {
          ...attempts,
          [side]: {
            ...attempts[side],
            status: "time-cap",
            endedAtMs: now() - started,
          },
        }
        record(side)
      }
    if (snapshot.remainingMs !== remaining() || snapshot.attempts !== attempts)
      publish()
  }
  const dispatch = (side: Side, action: GameAction) => {
    if (!running) return
    tick()
    const current = attempts[side]
    if (current.status !== "playing") return
    if (
      action.type === "selectCell" &&
      (!Number.isInteger(action.cell) ||
        action.cell < 0 ||
        action.cell >= packs[round].n ** 2)
    )
      return
    const next = applyGameAction(packs[round], current.state, action)
    const state = { ...next, actions: current.state.actions + 1 }
    const status: RoundStatus = verifyGame(packs[round], state.cells).complete
      ? "finished"
      : state.actions >= actionCap
        ? "action-cap"
        : "playing"
    attempts = {
      ...attempts,
      [side]: {
        ...current,
        state,
        status,
        endedAtMs: status === "playing" ? null : now() - started,
      },
    }
    if (status !== "playing") record(side)
    publish()
  }
  publish()
  return {
    getSnapshot: () => snapshot,
    start: () => {
      if (running) return false
      running = true
      started = now()
      publish()
      return true
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    tick,
    actions: (side: Side): SharedActions => ({
      selectCell: (cell) => dispatch(side, { type: "selectCell", cell }),
      cycle: () => dispatch(side, { type: "cycle" }),
      undo: () => dispatch(side, { type: "undo" }),
      clear: () => dispatch(side, { type: "clear" }),
    }),
    boardProps: (side: Side): BoardProps => {
      const pack = packs[round],
        attempt = attempts[side]
      return freeze({
        seed: pack.seed,
        n: pack.n,
        category: pack.category,
        mode: pack.mode,
        postcard: structuredClone(pack.postcard),
        clues: structuredClone(pack.rules),
        actionSurface: structuredClone(pack.actionSurface),
        cells: pack.cells.map((cell, index) => {
          const visible =
            pack.visibility.kind === "full" ||
            pack.visibility.visibleCells.includes(index)
          return {
            index,
            row: Math.floor(index / pack.n),
            column: index % pack.n,
            value: visible ? attempt.state.cells[index] : null,
            locked: visible && cell.locked,
            visible,
            selected: visible && attempt.state.selectedCell === index,
          }
        }),
        actions: attempt.state.actions,
        remainingActions: actionCap - attempt.state.actions,
        remainingMs: snapshot.remainingMs,
        status: attempt.status,
        readOnly: side === "learner" || attempt.status !== "playing",
        hints: "practice-only",
      })
    },
    claim: (side: Side, line: string) => {
      const claim = line.replace(/\s+/g, " ").trim().slice(0, 240)
      attempts = { ...attempts, [side]: { ...attempts[side], claim } }
      records = records.map((record) =>
        record.seed === packs[round].seed && record.side === side
          ? { ...record, claim }
          : record
      )
      publish()
    },
    advance: () => {
      tick()
      if (!bothEnded() || round + 1 >= packs.length) return false
      round++
      started = now()
      attempts = { human: fresh(), learner: fresh() }
      publish()
      return true
    },
    practice: options.practice ?? false,
  }
}

export function scoreTransfer(
  records: readonly BattleRecord[],
  side: Side,
  group: string
) {
  const rounds = records.filter(
    (record) => record.side === side && record.transferGroup === group
  )
  if (
    rounds.length < 3 ||
    rounds.some((record) => record.status !== "finished")
  )
    return { eligible: false, actionSlope: null, actionsFalling: false }
  const center = (rounds.length - 1) / 2
  const mean =
    rounds.reduce((sum, record) => sum + record.actions, 0) / rounds.length
  const actionSlope =
    rounds.reduce(
      (sum, record, index) => sum + (index - center) * (record.actions - mean),
      0
    ) / rounds.reduce((sum, _, index) => sum + (index - center) ** 2, 0)
  return {
    eligible: true,
    actionSlope,
    actionsFalling: rounds.every(
      (record, index) =>
        index === 0 || record.actions < rounds[index - 1].actions
    ),
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
