import type {
  Action,
  ActionAPI,
  Cell,
  Observation,
  Player,
  PlayerStatus,
  RoundRecord,
  RulePack,
} from "./types"
import { packErrors, verify } from "./verifier"

type PlayerState = {
  cells: readonly Cell[]
  selectedCell: number | null
  actions: number
  status: PlayerStatus
  history: readonly { cells: readonly Cell[]; selectedCell: number | null }[]
  patternClaim: string | null
}
export type MatchSnapshot = {
  round: number
  seed: number
  canAdvance: boolean
  remainingMs: number
  players: Readonly<Record<Player, Readonly<PlayerState>>>
  records: readonly RoundRecord[]
}
export type MatchOptions = {
  actionCap: number
  timeCapMs: number
  now?: () => number
}

/** Host/UI controller. Give L0 only observe('learner') and actions('learner'). */
export function createMatch(packs: readonly RulePack[], options: MatchOptions) {
  if (!packs.length || packs.some((pack) => packErrors(pack).length))
    throw new Error("Invalid packs")
  if (new Set(packs.map((pack) => pack.seed)).size !== packs.length)
    throw new Error("Round seeds must be distinct")
  if (
    packs.some(
      (pack) => !pack.cells.includes(null) || !verify(pack, pack.cells).valid
    )
  )
    throw new Error("Packs must have a valid, unfinished board")
  if (
    !Number.isInteger(options.actionCap) ||
    options.actionCap <= 0 ||
    !Number.isFinite(options.timeCapMs) ||
    options.timeCapMs <= 0
  )
    throw new Error("Invalid caps")
  // Copy inputs so host mutation cannot change either player's puzzle mid-round.
  const queue = structuredClone(packs)
  const now = options.now ?? Date.now
  const listeners = new Set<() => void>()
  let round = 0
  let startedAt = now()
  let records: RoundRecord[] = []
  const fresh = (): PlayerState => ({
    cells: [...queue[round].cells],
    selectedCell: null,
    actions: 0,
    status: "playing",
    history: [],
    patternClaim: null,
  })
  let players: Record<Player, PlayerState> = {
    human: fresh(),
    learner: fresh(),
  }
  const remaining = () => Math.max(0, options.timeCapMs - (now() - startedAt))
  const canAdvance = () =>
    players.human.status !== "playing" && players.learner.status !== "playing"
  let snapshot: MatchSnapshot
  const publish = () => {
    snapshot = {
      round,
      seed: queue[round].seed,
      canAdvance: canAdvance(),
      remainingMs: remaining(),
      players,
      records,
    }
    // Exposed snapshots are immutable, including nested board/history arrays.
    deepFreeze(snapshot)
    listeners.forEach((listener) => listener())
  }
  const record = (player: Player) => {
    const state = players[player]
    if (state.status === "playing") return
    records = [
      ...records,
      {
        seed: queue[round].seed,
        n: queue[round].n,
        transferGroup: `family-a-${queue[round].n}`,
        editableCells: queue[round].cells.filter((cell) => cell === null)
          .length,
        player,
        actions: state.actions,
        status: state.status,
        patternClaim: state.patternClaim,
      },
    ]
  }
  const tick = () => {
    let changed = false
    if (remaining() === 0)
      for (const player of ["human", "learner"] as const) {
        if (players[player].status !== "playing") continue
        players = {
          ...players,
          [player]: { ...players[player], status: "time-cap" },
        }
        record(player)
        changed = true
      }
    if (changed || snapshot.remainingMs !== remaining()) publish()
  }
  const dispatch = (player: Player, action: Action) => {
    tick()
    const state = players[player]
    if (state.status !== "playing") return
    let cells = state.cells
    let selectedCell = state.selectedCell
    let history = state.history
    const save = () => {
      history = [...history, { cells, selectedCell }]
    }
    if (action.type === "selectCell") {
      if (
        !Number.isInteger(action.cell) ||
        action.cell < 0 ||
        action.cell >= cells.length
      )
        return
      save()
      selectedCell = action.cell
    } else if (
      action.type === "cycle" &&
      selectedCell !== null &&
      queue[round].cells[selectedCell] === null
    ) {
      save()
      cells = cells.map((value, cell) =>
        cell !== selectedCell
          ? value
          : value === null
            ? 0
            : value === 0
              ? 1
              : null
      )
    } else if (action.type === "clear") {
      save()
      cells = [...queue[round].cells]
      selectedCell = null
    } else if (action.type === "undo" && history.length) {
      const previous = history[history.length - 1]
      cells = previous.cells
      selectedCell = previous.selectedCell
      history = history.slice(0, -1)
    }
    const actions = state.actions + 1 // All in-range attempts count, including no-ops.
    const status = verify(queue[round], cells).complete
      ? "finished"
      : actions >= options.actionCap
        ? "action-cap"
        : "playing"
    players = {
      ...players,
      [player]: { ...state, cells, selectedCell, history, actions, status },
    }
    if (status !== "playing") record(player)
    publish()
  }
  publish()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    tick,
    observe: (player: Player): Observation => {
      tick()
      const state = players[player]
      return deepFreeze({
        seed: queue[round].seed,
        n: queue[round].n,
        mode: queue[round].mode,
        rulesPostcard: [...queue[round].rulesPostcard],
        cells: [...state.cells],
        given: queue[round].cells.map((cell) => cell !== null),
        selectedCell: state.selectedCell,
        actions: state.actions,
        remainingActions: options.actionCap - state.actions,
        remainingMs: remaining(),
        status: state.status,
      })
    },
    actions: (player: Player): ActionAPI => ({
      selectCell: (cell) => dispatch(player, { type: "selectCell", cell }),
      cycle: () => dispatch(player, { type: "cycle" }),
      undo: () => dispatch(player, { type: "undo" }),
      clear: () => dispatch(player, { type: "clear" }),
    }),
    claim: (player: Player, text: string) => {
      const patternClaim = text.replace(/\s+/g, " ").trim().slice(0, 240)
      players = { ...players, [player]: { ...players[player], patternClaim } }
      records = records.map((record) =>
        record.seed === queue[round].seed && record.player === player
          ? { ...record, patternClaim }
          : record
      )
      publish()
    },
    advance: () => {
      tick()
      if (!canAdvance() || round + 1 >= queue.length) return false
      round++
      startedAt = now()
      players = { human: fresh(), learner: fresh() }
      publish()
      return true
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/** Compare completed near-transfer rounds only. Capped rounds are not wins. */
export function learningSlope(
  records: readonly RoundRecord[],
  player: Player,
  transferGroup: string
) {
  const rounds = records.filter(
    (record) =>
      record.player === player && record.transferGroup === transferGroup
  )
  if (
    rounds.length < 3 ||
    rounds.some((record) => record.status !== "finished")
  )
    return { eligible: false, slope: null, actionsFalling: false }
  const meanX = (rounds.length - 1) / 2
  const meanY =
    rounds.reduce((sum, record) => sum + record.actions, 0) / rounds.length
  const slope =
    rounds.reduce(
      (sum, record, index) => sum + (index - meanX) * (record.actions - meanY),
      0
    ) / rounds.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0)
  return {
    eligible: true,
    slope,
    actionsFalling: rounds.every(
      (record, index) =>
        index === 0 || record.actions < rounds[index - 1].actions
    ),
  }
}
