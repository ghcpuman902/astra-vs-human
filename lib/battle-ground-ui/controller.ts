import {
  describeBoard,
  type BoardAffordances,
} from "../mini-game-rules/affordances"
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
  /** Clock origin for this side's current attempt. Null until the match starts. */
  startedAt: number | null
  endedAtMs: number | null
  claim: string | null
}
export type SideCursor = {
  index: number
  game: number
  round: number
}
export type BattleRecord = {
  seed: number
  side: Side
  transferGroup: string
  status: Exclude<RoundStatus, "playing">
  actions: number
  elapsedMs: number
  claim: string | null
  /** Board when the round closed. Missing on matches saved before this field. */
  cells?: readonly (number | null)[]
}
export type BattleSnapshot = {
  gameCount: number
  roundsPerGame: number
  cursors: Record<Side, SideCursor>
  seeds: Record<Side, number>
  remainingMs: Record<Side, number>
  attempts: Record<Side, Attempt>
  /** Time spent on the current attempt, including a paused carry. */
  attemptMs: Record<Side, number>
  /** This side has ended its attempt and a later pack exists. The other side is not consulted. */
  canAdvance: Record<Side, boolean>
  hasNext: Record<Side, boolean>
  /**
   * This side ran out of time and chose to keep solving. The board plays on,
   * but it already counts as unsolved and a late solve is never recorded.
   */
  overtime: Record<Side, boolean>
  records: readonly BattleRecord[]
  /** Both sides have ended the last pack. Not a per-round lock. */
  matchComplete: boolean
}
export type BoardProps = {
  seed: number
  n: number
  category: GamePack["category"]
  mode: GamePack["mode"]
  postcard: GamePack["postcard"]
  clues: GamePack["rules"]
  actionSurface: GamePack["actionSurface"]
  /** Engine-authored legality and cycle semantics. UI and solver must read this. */
  affordances: BoardAffordances
  cells: {
    index: number
    row: number
    column: number
    value: number | null
    locked: boolean
    visible: boolean
    selected: boolean
    /** open | given | inert — from affordances.cells[index].role */
    role: BoardAffordances["cells"][number]["role"]
  }[]
  actions: number
  remainingActions: number
  remainingMs: number
  status: RoundStatus
  readOnly: boolean
  hints: "practice-only"
}
/** Plain JSON copy of a match in progress. Clock values are elapsed ms, not timestamps. */
export type BattleDump = {
  cursor: Record<Side, number>
  records: BattleRecord[]
  attempts: Record<
    Side,
    {
      state: GameState
      status: RoundStatus
      claim: string | null
      /** Elapsed on this attempt when dumped (or its end time once it ended). */
      elapsedMs: number
    }
  >
  /** Elapsed on each side's whole-match clock. */
  matchMs: Record<Side, number>
  /** This side's match clock already stopped at matchMs. */
  stopped: Record<Side, boolean>
  /** Missing on matches saved before overtime existed. */
  overtime?: Record<Side, boolean>
}
export type BattleOptions = {
  actionCap?: number
  /**
   * When false, the human never ends a round for tap count.
   * The learner still stops at `actionCap` so a looping model cannot run forever.
   */
  limitHumanTaps?: boolean
  timeCapMs?: number
  practice?: boolean
  startPaused?: boolean
  now?: () => number
  /** Packs are grouped into games of this many rounds. Defaults to one game. */
  roundsPerGame?: number
  /**
   * `attempt` resets the cap on each round.
   * `side` is one clock per player. Advancing does not reset it or stop the other side.
   */
  clock?: "attempt" | "side"
  /** Resume from `dump()`. The match comes back paused; `start()` resumes both clocks. */
  restore?: BattleDump
}
const SIDES = ["human", "learner"] as const

export function transferGroup(pack: GamePack): string {
  return [
    pack.category,
    pack.n,
    pack.mode,
    pack.visibility.kind,
    pack.transfer.family,
  ].join(":")
}

/**
 * Session bridge. Each side keeps its own cursor, clock, and attempt.
 * A shared pack/seed applies only while both cursors sit on that round.
 * Advancing one side never moves the other.
 */
export function createBattleGround(
  input: readonly GamePack[],
  options: BattleOptions = {}
) {
  if (
    !input.length ||
    new Set(input.map((pack) => pack.seed)).size !== input.length
  )
    throw new Error("Supply distinct round seeds")
  const roundsPerGame = options.roundsPerGame ?? input.length
  if (
    !Number.isInteger(roundsPerGame) ||
    roundsPerGame <= 0 ||
    input.length % roundsPerGame !== 0
  )
    throw new Error("Rounds per game must divide the pack list")
  const packs = input.map((pack) => packSchema.parse(structuredClone(pack)))
  const gameCount = packs.length / roundsPerGame
  const actionCap = options.actionCap ?? 300
  const limitHumanTaps = options.limitHumanTaps ?? true
  // 10–120s is the intended length of one attempt. A stuck side gets its own 10min cap.
  const timeCapMs = options.timeCapMs ?? 600_000
  if (
    !Number.isInteger(actionCap) ||
    actionCap <= 0 ||
    !Number.isFinite(timeCapMs) ||
    timeCapMs <= 0
  )
    throw new Error("Invalid caps")
  const now = options.now ?? (() => performance.now())
  const clock = options.clock ?? "attempt"
  const listeners = new Set<() => void>()
  const restore = options.restore
  if (
    restore &&
    SIDES.some(
      (side) =>
        !Number.isInteger(restore.cursor[side]) ||
        restore.cursor[side] < 0 ||
        restore.cursor[side] >= packs.length ||
        restore.attempts[side].state.cells.length !==
          packs[restore.cursor[side]].n ** 2
    )
  )
    throw new Error("Saved match does not fit these packs")
  let cursor: Record<Side, number> = restore
    ? { ...restore.cursor }
    : { human: 0, learner: 0 }
  let running = !options.startPaused && !restore
  let records: BattleRecord[] = restore ? [...restore.records] : []
  let overtime: Record<Side, boolean> = {
    human: restore?.overtime?.human ?? false,
    learner: restore?.overtime?.learner ?? false,
  }
  // Time already on the clocks from before a reload. Applied once on start().
  const carry = {
    attempt: {
      human: restore?.attempts.human.elapsedMs ?? 0,
      learner: restore?.attempts.learner.elapsedMs ?? 0,
    },
    match: {
      human: restore?.matchMs.human ?? 0,
      learner: restore?.matchMs.learner ?? 0,
    },
  }
  const openedAt = running ? now() : null
  let origin: Record<Side, number | null> = {
    human: openedAt,
    learner: openedAt,
  }
  let stoppedAt: Record<Side, number | null> = {
    human: restore?.stopped.human ? carry.match.human : null,
    learner: restore?.stopped.learner ? carry.match.learner : null,
  }
  const fresh = (side: Side, startedAt: number | null): Attempt => ({
    state: initialGameState(packs[cursor[side]]),
    status: "playing",
    startedAt,
    endedAtMs: null,
    claim: null,
  })
  const restored = (side: Side): Attempt => {
    const saved = restore!.attempts[side]
    return {
      state: structuredClone(saved.state),
      status: saved.status,
      startedAt: null,
      endedAtMs: saved.status === "playing" ? null : saved.elapsedMs,
      claim: saved.claim,
    }
  }
  let attempts: Record<Side, Attempt> = restore
    ? { human: restored("human"), learner: restored("learner") }
    : {
        human: fresh("human", openedAt),
        learner: fresh("learner", openedAt),
      }
  let snapshot: BattleSnapshot
  const position = (index: number): SideCursor => ({
    index,
    game: Math.floor(index / roundsPerGame),
    round: index % roundsPerGame,
  })
  const attemptElapsed = (side: Side) => {
    const attempt = attempts[side]
    if (attempt.status !== "playing") return attempt.endedAtMs ?? 0
    if (attempt.startedAt == null) return carry.attempt[side]
    return Math.max(0, now() - attempt.startedAt)
  }
  const matchElapsed = (side: Side) => {
    if (stoppedAt[side] != null) return stoppedAt[side]!
    if (origin[side] == null) return carry.match[side]
    return Math.max(0, now() - origin[side]!)
  }
  const remaining = (side: Side) =>
    Math.max(
      0,
      timeCapMs - (clock === "side" ? matchElapsed(side) : attemptElapsed(side))
    )
  const sideCanAdvance = (side: Side) =>
    running &&
    (attempts[side].status !== "playing" || overtime[side]) &&
    cursor[side] + 1 < packs.length &&
    !(clock === "side" && remaining(side) <= 0)
  const publish = () => {
    snapshot = freeze({
      gameCount,
      roundsPerGame,
      cursors: {
        human: position(cursor.human),
        learner: position(cursor.learner),
      },
      seeds: {
        human: packs[cursor.human].seed,
        learner: packs[cursor.learner].seed,
      },
      remainingMs: { human: remaining("human"), learner: remaining("learner") },
      attempts,
      attemptMs: {
        human: Math.round(attemptElapsed("human")),
        learner: Math.round(attemptElapsed("learner")),
      },
      canAdvance: {
        human: sideCanAdvance("human"),
        learner: sideCanAdvance("learner"),
      },
      hasNext: {
        human: cursor.human + 1 < packs.length,
        learner: cursor.learner + 1 < packs.length,
      },
      overtime,
      records,
      matchComplete: SIDES.every((side) => {
        if (attempts[side].status === "playing" && !overtime[side]) return false
        if (clock === "side")
          return remaining(side) <= 0 || cursor[side] + 1 >= packs.length
        return cursor[side] + 1 >= packs.length
      }),
    })
    listeners.forEach((listener) => listener())
  }
  const record = (side: Side) => {
    const attempt = attempts[side]
    // The time-cap record already stands for a board solved in overtime.
    if (attempt.status === "playing" || overtime[side]) return
    const pack = packs[cursor[side]]
    records = [
      ...records,
      {
        seed: pack.seed,
        side,
        transferGroup: transferGroup(pack),
        status: attempt.status,
        actions: attempt.state.actions,
        elapsedMs: attempt.endedAtMs ?? attemptElapsed(side),
        claim: attempt.claim,
        cells: [...attempt.state.cells],
      },
    ]
  }
  const tick = () => {
    if (running)
      for (const side of SIDES) {
        const attempt = attempts[side]
        if (clock === "side") {
          const elapsed =
            origin[side] == null ? 0 : Math.max(0, now() - origin[side]!)
          if (stoppedAt[side] == null && elapsed >= timeCapMs) {
            if (attempt.status === "playing" && !overtime[side]) {
              attempts = {
                ...attempts,
                [side]: {
                  ...attempt,
                  status: "time-cap",
                  endedAtMs: attemptElapsed(side),
                },
              }
              record(side)
            }
            stoppedAt = { ...stoppedAt, [side]: timeCapMs }
          } else if (
            stoppedAt[side] == null &&
            origin[side] != null &&
            attempts[side].status !== "playing" &&
            cursor[side] + 1 >= packs.length
          ) {
            stoppedAt = { ...stoppedAt, [side]: elapsed }
          }
          continue
        }
        if (
          attempt.status !== "playing" ||
          overtime[side] ||
          attempt.startedAt == null ||
          now() - attempt.startedAt < timeCapMs
        )
          continue
        attempts = {
          ...attempts,
          [side]: {
            ...attempt,
            status: "time-cap",
            endedAtMs: now() - attempt.startedAt,
          },
        }
        record(side)
      }
    const nextHuman = remaining("human")
    const nextLearner = remaining("learner")
    if (
      snapshot.remainingMs.human !== nextHuman ||
      snapshot.remainingMs.learner !== nextLearner ||
      snapshot.attempts !== attempts
    )
      publish()
  }
  const dispatch = (side: Side, action: GameAction) => {
    if (!running) return
    tick()
    const current = attempts[side]
    if (current.status !== "playing") return
    const pack = packs[cursor[side]]
    if (
      action.type === "selectCell" &&
      (!Number.isInteger(action.cell) ||
        action.cell < 0 ||
        action.cell >= pack.n ** 2)
    )
      return
    const result = applyGameAction(pack, current.state, action)
    if (!result.ok) return
    const state = result.state
    const overTaps =
      state.actions >= actionCap && (side === "learner" || limitHumanTaps)
    const status: RoundStatus = verifyGame(pack, state.cells).complete
      ? "finished"
      : overTaps
        ? "action-cap"
        : "playing"
    attempts = {
      ...attempts,
      [side]: {
        ...current,
        state,
        status,
        endedAtMs: status === "playing" ? null : attemptElapsed(side),
      },
    }
    if (status !== "playing") record(side)
    if (
      clock === "side" &&
      status !== "playing" &&
      stoppedAt[side] == null &&
      origin[side] != null &&
      cursor[side] + 1 >= packs.length
    ) {
      stoppedAt = {
        ...stoppedAt,
        [side]: Math.max(0, now() - origin[side]!),
      }
    }
    publish()
  }
  publish()
  return {
    getSnapshot: () => snapshot,
    start: () => {
      if (running) return false
      running = true
      const startedAt = now()
      origin = {
        human: startedAt - carry.match.human,
        learner: startedAt - carry.match.learner,
      }
      attempts = {
        human: {
          ...attempts.human,
          startedAt: startedAt - carry.attempt.human,
        },
        learner: {
          ...attempts.learner,
          startedAt: startedAt - carry.attempt.learner,
        },
      }
      carry.attempt = { human: 0, learner: 0 }
      carry.match = { human: 0, learner: 0 }
      publish()
      return true
    },
    /** Freeze both clocks where they are. `start()` picks them up again. */
    pause: () => {
      if (!running) return false
      tick()
      carry.attempt = {
        human: attemptElapsed("human"),
        learner: attemptElapsed("learner"),
      }
      carry.match = {
        human: matchElapsed("human"),
        learner: matchElapsed("learner"),
      }
      running = false
      origin = { human: null, learner: null }
      attempts = {
        human: { ...attempts.human, startedAt: null },
        learner: { ...attempts.learner, startedAt: null },
      }
      publish()
      return true
    },
    /** True while clocks run. False before Start and after a restore until resumed. */
    running: () => running,
    dump: (): BattleDump => {
      const side = (key: Side) => ({
        state: structuredClone(attempts[key].state) as GameState,
        status: attempts[key].status,
        claim: attempts[key].claim,
        elapsedMs: Math.round(attemptElapsed(key)),
      })
      return {
        cursor: { ...cursor },
        records: records.map((entry) => ({ ...entry })),
        attempts: { human: side("human"), learner: side("learner") },
        matchMs: {
          human: Math.round(matchElapsed("human")),
          learner: Math.round(matchElapsed("learner")),
        },
        stopped: {
          human: stoppedAt.human != null,
          learner: stoppedAt.learner != null,
        },
        overtime: { ...overtime },
      }
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
      const pack = packs[cursor[side]]
      const attempt = attempts[side]
      const affordances = describeBoard(pack, attempt.state)
      return freeze({
        seed: pack.seed,
        n: pack.n,
        category: pack.category,
        mode: pack.mode,
        postcard: structuredClone(pack.postcard),
        clues: structuredClone(pack.rules),
        actionSurface: structuredClone(pack.actionSurface),
        affordances: structuredClone(affordances),
        cells: pack.cells.map((cell, index) => {
          const visible =
            pack.visibility.kind === "full" ||
            pack.visibility.visibleCells.includes(index)
          const role = affordances.cells[index]?.role ?? "inert"
          return {
            index,
            row: Math.floor(index / pack.n),
            column: index % pack.n,
            value: visible ? attempt.state.cells[index] : null,
            locked: visible && cell.locked,
            visible,
            selected: visible && attempt.state.selectedCell === index,
            role,
          }
        }),
        actions: attempt.state.actions,
        remainingActions: actionCap - attempt.state.actions,
        remainingMs: snapshot.remainingMs[side],
        status: attempt.status,
        readOnly: side === "learner" || attempt.status !== "playing",
        hints: "practice-only",
      })
    },
    claim: (side: Side, line: string) => {
      const claim = line.replace(/\s+/g, " ").trim().slice(0, 240)
      attempts = { ...attempts, [side]: { ...attempts[side], claim } }
      const seed = packs[cursor[side]].seed
      records = records.map((entry) =>
        entry.seed === seed && entry.side === side ? { ...entry, claim } : entry
      )
      publish()
    },
    /** After a time-cap: reopen this board for unscored play. */
    keepPlaying: (side: Side) => {
      if (!running || attempts[side].status !== "time-cap") return false
      overtime = { ...overtime, [side]: true }
      attempts = {
        ...attempts,
        [side]: { ...attempts[side], status: "playing", endedAtMs: null },
      }
      publish()
      return true
    },
    advance: (side: Side) => {
      tick()
      if (!sideCanAdvance(side)) return false
      overtime = { ...overtime, [side]: false }
      cursor = { ...cursor, [side]: cursor[side] + 1 }
      attempts = {
        ...attempts,
        [side]: fresh(side, now()),
      }
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

export type BlitzTally = {
  rounds: number
  actions: number
  leftoverMs: number
}

/** Rounds that ended before this side's clock hit zero. */
export function tallyBlitz(
  records: readonly BattleRecord[],
  side: Side,
  leftoverMs: number
): BlitzTally {
  const done = records.filter(
    (record) => record.side === side && record.status !== "time-cap"
  )
  return {
    rounds: done.length,
    actions: done.reduce((sum, record) => sum + record.actions, 0),
    leftoverMs,
  }
}

/** More rounds, then fewer actions, then more time left. */
export function compareBlitz(
  human: BlitzTally,
  learner: BlitzTally
): "human" | "learner" | "tie" {
  if (human.rounds !== learner.rounds)
    return human.rounds > learner.rounds ? "human" : "learner"
  if (human.actions !== learner.actions)
    return human.actions < learner.actions ? "human" : "learner"
  if (human.leftoverMs !== learner.leftoverMs)
    return human.leftoverMs > learner.leftoverMs ? "human" : "learner"
  return "tie"
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
