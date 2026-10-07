"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { AlertDialog } from "@base-ui/react/alert-dialog"
import {
  ArrowLeft,
  Hourglass,
  Lock,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
} from "lucide-react"

import { AgentPip } from "@/components/agent-pip"
import { AgentTrace } from "@/components/agent-trace"
import { MatchResults } from "@/components/match-results"
import { BoardStage, Phone, Rules } from "@/components/lovable/battle-field"
import { RoundStrip } from "@/components/lovable/round-strip"
import {
  AgentModelMenu,
  LENGTH_COPY,
  mixUsesLanguageModel,
  modeName,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { MatchInfo, MatchSettings } from "@/components/match-settings"
import { ThemeToggle } from "@/components/theme-provider"
import { SetupScreen } from "@/components/setup-screen"
import {
  rememberDeal,
  useDealMemory,
  useMounted,
} from "@/hooks/use-deal-memory"
import { useLearnerModel } from "@/hooks/use-learner-model"
import { useSideLearner } from "@/hooks/use-side-learner"
import { createAgentTrace } from "@/lib/battle-ground-ui/agent-trace"
import {
  compareBlitz,
  createBattleGround,
  scoreTransfer,
  tallyBlitz,
  transferGroup,
  type BattleRecord,
  type Side,
  type SideCursor,
} from "@/lib/battle-ground-ui/controller"
import type { FamilyMarks } from "@/lib/battle-ground-ui/family-bias"
import {
  dealTitle,
  familyLabel,
  formatClock,
} from "@/lib/battle-ground-ui/labels"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import {
  DEFAULT_MATCH_LENGTH,
  freshDeal,
  freshDealIdle,
  randomDeepFamily,
  type DealtMatch,
  type MatchLength,
} from "@/lib/battle-ground-ui/match-deck"
import {
  clearMatch,
  readMatch,
  saveMatch,
  type SavedMatch,
} from "@/lib/match-memory"
import { verifyGame } from "@/lib/mini-game-rules/verifier"

const MATCH_ID = "match"

const roundText = (
  length: MatchLength,
  cursor: SideCursor,
  gameCount: number,
  roundsPerGame: number
) => {
  if (length === "deep") return `Round ${cursor.round + 1} of ${roundsPerGame}`
  if (length === "tour") return `Family ${cursor.game + 1} of ${gameCount}`
  return `Board ${cursor.index + 1}`
}

const spentMs = (records: readonly BattleRecord[], side: Side) =>
  records
    .filter((record) => record.side === side)
    .reduce((sum, record) => sum + record.elapsedMs, 0)

const historyBase = () =>
  history.state && typeof history.state === "object"
    ? { ...(history.state as Record<string, unknown>) }
    : {}

const hrefWithoutMatch = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete("match")
  return url.pathname + url.search + url.hash
}

const hrefWithMatch = () => {
  const url = new URL(window.location.href)
  url.searchParams.set("match", "1")
  return url.pathname + url.search + url.hash
}

/** One history entry per visit to a match, so the browser Back button returns to setup. */
const ensureMatchHistory = () => {
  const url = new URL(window.location.href)
  const has = url.searchParams.get("match") === "1"
  const base = historyBase()
  if (!has) {
    history.pushState({ ...base, battle: "match" }, "", hrefWithMatch())
    return
  }
  if (base.battle === "match") return
  history.replaceState({ ...base, battle: "setup" }, "", hrefWithoutMatch())
  history.pushState({ ...history.state, battle: "match" }, "", hrefWithMatch())
}

const isMatchHistory = () => history.state?.battle === "match"

/** Midpoint of both boards, covers while they are hidden and grids once they are open. */
const placeShared = (node: HTMLElement) => {
  const covers = document.querySelectorAll(".puzzle-cover")
  const targets =
    covers.length > 0 ? covers : document.querySelectorAll(".puzzle-grid")
  if (targets.length === 0) return
  const boxes = [...targets].map((target) => target.getBoundingClientRect())
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.right))
  const top = Math.min(...boxes.map((box) => box.top))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  const x = `${(left + right) / 2}px`
  const y = `${(top + bottom) / 2}px`
  if (node.style.left !== x) node.style.left = x
  if (node.style.top !== y) node.style.top = y
}

const SharedFloat = ({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    // Boards move without a window event (cover to grid, next round, layout settling),
    // so follow them every frame. placeShared only writes when the midpoint changed.
    let frame = requestAnimationFrame(function follow() {
      placeShared(node)
      frame = requestAnimationFrame(follow)
    })
    placeShared(node)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="shared-float" ref={ref}>
      <button
        type="button"
        className="primary-button shared-button"
        data-slot="match-next"
        disabled={disabled}
        onClick={onClick}
      >
        <Play aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}

export function BattleApp() {
  const mounted = useMounted()
  const memory = useDealMemory()
  const models = useLearnerModel()
  const [arena, setArena] = useState<Arena>("play")
  const [leftMix, setLeftMix] = useState<LearnerMixId>("astra")
  const [rightMix, setRightMix] = useState<LearnerMixId>("astra")
  const [length, setLength] = useState<MatchLength>(DEFAULT_MATCH_LENGTH)
  const [marks, setMarks] = useState<FamilyMarks>({ played: [], disliked: [] })
  const [preview, setPreview] = useState<DealtMatch | null>(null)
  const [dealt, setDealt] = useState<DealtMatch | null>(null)
  const [dealing, setDealing] = useState(false)
  const [pendingFamilyId, setPendingFamilyId] = useState<string | null>(null)
  const dealGen = useRef(0)
  // "Different game" walks every family once before any comes back.
  const shownFamilies = useRef<string[]>([])
  const [session, setSession] = useState(0)
  const [source, setSource] = useState("fresh local boards")
  const [servers, setServers] = useState<Servers | null>(null)
  // A match saved in this browser before a reload, read once after mount.
  const [checked, setChecked] = useState(false)
  const [resume, setResume] = useState<SavedMatch | null>(null)
  const avoid = useMemo(() => new Set(memory.boards), [memory.boards])
  const setup = useMemo(
    () => ({ arena, leftMix, rightMix, length, marks, practice: false }),
    [arena, leftMix, rightMix, length, marks]
  )
  useEffect(() => {
    let cancelled = false
    fetch("/api/learner-mix")
      .then((response) => response.json())
      .then((body: Partial<Record<keyof Servers, unknown>>) => {
        if (cancelled) return
        setServers({
          openai: body.openai === true,
          gateway: body.gateway === true,
          jev: body.jev === true,
          laya: body.laya === true,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  // Boards are assembled in this browser on every deal, never cached server-side.
  const dealFor = (
    nextLength: MatchLength,
    nextMarks: FamilyMarks,
    familyId?: string | null
  ) =>
    freshDeal(
      nextLength,
      { ...nextMarks, recent: memory.recent },
      { familyId, avoid }
    )
  if (mounted && !checked) {
    setChecked(true)
    const saved = readMatch()
    if (saved) {
      setArena(saved.setup.arena)
      setLeftMix(saved.setup.leftMix)
      setRightMix(saved.setup.rightMix)
      setLength(saved.setup.length)
      setMarks(saved.setup.marks)
      setSource(saved.source)
      setDealt(saved.dealt)
      setResume(saved)
    }
  }
  const queueDeal = (
    nextLength: MatchLength,
    nextMarks: FamilyMarks,
    familyId?: string
  ) => {
    const gen = ++dealGen.current
    setDealing(true)
    setPendingFamilyId(nextLength === "deep" ? (familyId ?? null) : null)
    const recentMarks = { ...nextMarks, recent: memory.recent }
    void freshDealIdle(nextLength, recentMarks, { familyId, avoid })
      .then((next) => {
        if (dealGen.current !== gen) return
        setPreview(next)
        setDealing(false)
        setPendingFamilyId(null)
      })
      .catch(() => {
        if (dealGen.current !== gen) return
        setDealing(false)
        setPendingFamilyId(null)
      })
  }

  useEffect(() => {
    if (!mounted || !checked || dealt || preview) return
    queueDeal(length, marks)
    // Length and marks are whatever the form holds when the board is empty.
    // A fresh queueDeal identity must not start another deal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, checked, dealt, preview])
  const play = (next: DealtMatch, label = "fresh local boards") => {
    clearMatch()
    models.endRound(MATCH_ID)
    setResume(null)
    rememberDeal(next)
    setDealt(next)
    setSource(label)
    setSession((value) => value + 1)
  }

  const leaveMatch = () => {
    clearMatch()
    models.endRound(MATCH_ID)
    setResume(null)
    setDealt(null)
  }
  const dealtRef = useRef(dealt)
  dealtRef.current = dealt
  const leaveRef = useRef(leaveMatch)
  leaveRef.current = leaveMatch

  useEffect(() => {
    if (!dealt) return
    ensureMatchHistory()
  }, [dealt])

  useEffect(() => {
    const onPop = () => {
      const onMatchUrl =
        new URL(window.location.href).searchParams.get("match") === "1"
      if (!onMatchUrl && dealtRef.current) {
        leaveRef.current()
        return
      }
      if (onMatchUrl && !dealtRef.current) {
        history.replaceState(
          { ...historyBase(), battle: "setup" },
          "",
          hrefWithoutMatch()
        )
      }
    }
    window.addEventListener("popstate", onPop, true)
    return () => window.removeEventListener("popstate", onPop, true)
  }, [])

  const backToSetup = () => {
    if (isMatchHistory()) {
      history.back()
      return
    }
    leaveMatch()
  }

  if (!dealt) {
    return (
      <SetupScreen
        arena={arena}
        leftMix={leftMix}
        rightMix={rightMix}
        length={length}
        preview={preview}
        servers={servers}
        model={models}
        onArena={setArena}
        onLeftMix={setLeftMix}
        onRightMix={setRightMix}
        dealing={dealing}
        pendingFamilyId={pendingFamilyId}
        onLength={(next) => {
          setLength(next)
          const familyId =
            next === "deep" ? (preview?.familyId ?? undefined) : undefined
          queueDeal(next, marks, familyId)
        }}
        onFamily={(familyId) => {
          setLength("deep")
          queueDeal("deep", marks, familyId)
        }}
        onRespawn={() => {
          if (length !== "deep") {
            queueDeal(length, marks)
            return
          }
          const current = preview?.familyId
          if (current && !shownFamilies.current.includes(current))
            shownFamilies.current.push(current)
          let next = randomDeepFamily(marks, shownFamilies.current)
          if (shownFamilies.current.includes(next.id)) {
            shownFamilies.current = current ? [current] : []
            next = randomDeepFamily(marks, shownFamilies.current)
          }
          queueDeal(length, marks, next.id)
        }}
        onPlay={() => {
          if (!preview || dealing) return
          setPreview(null)
          play(preview)
        }}
      />
    )
  }
  return (
    <BattleSession
      key={session}
      dealt={dealt}
      arena={arena}
      leftMix={leftMix}
      rightMix={rightMix}
      source={source}
      servers={servers}
      resume={resume}
      setup={setup}
      models={models}
      onLeftMix={setLeftMix}
      onRightMix={setRightMix}
      onRestart={(next) => {
        setArena(next.arena)
        setLength(next.length)
        play(dealFor(next.length, marks))
      }}
      onRematch={() => play(dealFor(dealt.length, marks, dealt.familyId))}
      onNextFamily={() => play(dealFor("deep", marks))}
      onSetup={backToSetup}
      sameFamilyLabel={
        dealt.length === "deep" ? familyLabel(dealt.packs[0]) : null
      }
    />
  )
}

function BattleSession({
  dealt,
  arena,
  leftMix,
  rightMix,
  source,
  servers,
  resume,
  setup,
  models,
  sameFamilyLabel,
  onLeftMix,
  onRightMix,
  onRestart,
  onRematch,
  onNextFamily,
  onSetup,
}: {
  dealt: DealtMatch
  resume: SavedMatch | null
  setup: SavedMatch["setup"]
  arena: Arena
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  source: string
  servers: Servers | null
  models: ReturnType<typeof useLearnerModel>
  sameFamilyLabel: string | null
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onRestart: (next: { arena: Arena; length: MatchLength }) => void
  onRematch: () => void
  onNextFamily: () => void
  onSetup: () => void
}) {
  const { packs, length, gameCount, roundsPerGame, clock } = dealt
  const cap = dealt.timeCapMs ?? 600_000
  // A saved match that no longer fits these packs is dropped, not half-restored.
  const [{ battle, restored }] = useState(() => {
    const options = {
      timeCapMs: cap,
      actionCap: 300,
      limitHumanTaps: false,
      startPaused: true,
      roundsPerGame,
      clock,
      practice: false,
    }
    if (resume)
      try {
        return {
          battle: createBattleGround(packs, {
            ...options,
            restore: resume.battle,
          }),
          restored: resume,
        }
      } catch {}
    return { battle: createBattleGround(packs, options), restored: null }
  })
  const [traces] = useState(() => ({
    human: createAgentTrace(restored?.traces.human),
    learner: createAgentTrace(restored?.traces.learner),
  }))
  // Restored mid-match: clocks stay paused until Resume. A finished match reopens on its results.
  const [paused] = useState(() =>
    Boolean(restored?.started && !restored.finished)
  )
  const snapshot = useSyncExternalStore(
    battle.subscribe,
    battle.getSnapshot,
    battle.getSnapshot
  )
  const {
    getModel,
    getRivalModel,
    endRound,
    startRound,
    chooseModel,
    chooseRival,
  } = models
  const [started, setStarted] = useState(() => Boolean(restored?.finished))
  const awaitingResume = paused && !started
  const watching = arena === "watch"
  const [lastCell, setLastCell] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  // Settings open: both clocks and both agents hold still until it closes.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [halted, setHalted] = useState(false)
  const humanPack = packs[snapshot.cursors.human.index]
  const learnerPack = packs[snapshot.cursors.learner.index]
  // Overtime: the round already closed on time, the board just stays open.
  const overtime = snapshot.overtime.human
  const closed = (side: Side) =>
    snapshot.attempts[side].status !== "playing" || snapshot.overtime[side]
  const humanDone = started && closed("human")
  const armed = started && !snapshot.matchComplete
  const live = started && !halted
  const leftLearner = useSideLearner({
    enabled: watching,
    side: "human",
    battle,
    packs,
    started: live,
    mix: leftMix,
    getModel: getRivalModel,
    trace: traces.human,
  })
  const rightLearner = useSideLearner({
    enabled: true,
    side: "learner",
    battle,
    packs,
    started: live,
    mix: rightMix,
    getModel,
    trace: traces.learner,
  })
  const leftName = watching ? "Agent A" : "Human"
  const rightName = watching ? "Agent B" : "Agent"
  const leftAbility = watching ? modeName(leftMix) : "Your taps"
  const rightAbility = modeName(rightMix)

  useEffect(() => {
    if (!started) return
    const timer = setInterval(battle.tick, 250)
    return () => clearInterval(timer)
  }, [battle, started])
  useEffect(() => {
    if (length !== "blitz" || !started || watching) return
    if (snapshot.attempts.human.status === "playing") return
    if (!snapshot.canAdvance.human) return
    battle.advance("human")
  }, [battle, length, snapshot, started, watching])
  useEffect(() => {
    if (!snapshot.matchComplete) return
    endRound(MATCH_ID)
  }, [endRound, snapshot.matchComplete])
  // The model a restored match was dealt with stays picked until the player swaps it.
  const restoredModel = restored?.model
  const restoredRival = restored?.rivalModel
  useEffect(() => {
    if (models.status !== "ready") return
    if (restoredModel) chooseModel(restoredModel)
    if (restoredRival) chooseRival(restoredRival)
  }, [chooseModel, chooseRival, models.status, restoredModel, restoredRival])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (watching) return
      if (
        event.key.toLowerCase() !== "z" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return
      const attempt = battle.getSnapshot().attempts.human
      if (attempt.status !== "playing" || !attempt.state.history.length) return
      battle.actions("human").undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [battle, watching])

  const holdClocks = (hold: boolean) => {
    if (hold) {
      if (battle.pause()) setHalted(true)
    } else if (halted) {
      battle.start()
      setHalted(false)
    }
  }
  const setSettings = (open: boolean) => {
    holdClocks(open)
    setSettingsOpen(open)
  }
  // Leaving a running match asks first; the clocks hold while it does.
  const setLeave = (open: boolean) => {
    holdClocks(open)
    setLeaveOpen(open)
  }

  const humanBoard = battle.boardProps("human")
  const learnerBoard = battle.boardProps("learner")
  const humanAttempt = snapshot.attempts.human
  const learnerAttempt = snapshot.attempts.learner
  const report = verifyGame(
    humanPack,
    humanBoard.cells.map((cell) => (cell.visible ? cell.value : null))
  )
  const showInvalid =
    !report.valid &&
    humanPack.category !== "tile_rotate_connect" &&
    humanPack.category !== "lights_toggle"
  const handleStart = () => {
    if (models.status !== "ready") return
    if (!startRound(MATCH_ID)) return
    if (!battle.start()) return
    setStarted(true)
  }
  const handleTap = (cell: number) => {
    if (watching) return
    setLastCell(cell)
    const actions = battle.actions("human")
    actions.selectCell(cell)
    actions.cycle()
  }
  const handlePathStep = (cell: number, cycles: number) => {
    if (watching) return
    setLastCell(cell)
    const actions = battle.actions("human")
    actions.selectCell(cell)
    for (let step = 0; step < cycles; step++) actions.cycle()
  }
  const blitzDone =
    length === "blitz" &&
    started &&
    closed("human") &&
    closed("learner") &&
    !snapshot.canAdvance.human &&
    !snapshot.canAdvance.learner
  const nextLabel = !snapshot.hasNext.human
    ? "Match complete"
    : length === "blitz" && snapshot.remainingMs.human <= 0
      ? "Time's up"
      : length === "tour"
        ? "Next family"
        : length === "blitz"
          ? "Next board"
          : "Next round"
  // A side is finished when its attempt ended and nothing is left to advance to.
  const sideFinished = (side: Side) =>
    started &&
    closed(side) &&
    // Paused clocks block advancing too; that is not the same as being done.
    (!snapshot.hasNext[side] || (!snapshot.canAdvance[side] && !halted))
  const humanFinished = sideFinished("human")
  const matchOver =
    snapshot.matchComplete ||
    blitzDone ||
    (humanFinished && sideFinished("learner"))
  const humanTally = tallyBlitz(
    snapshot.records,
    "human",
    snapshot.remainingMs.human
  )
  const learnerTally = tallyBlitz(
    snapshot.records,
    "learner",
    snapshot.remainingMs.learner
  )
  const winner = compareBlitz(humanTally, learnerTally)
  const learnerCursor = snapshot.cursors.learner
  const learnerFinished = sideFinished("learner")
  const unit =
    length === "deep" ? "round" : length === "tour" ? "family" : "board"
  // One line under the buttons: how this board ended, then where the other side is.
  const paceNote = (() => {
    if (!started || watching) return null
    const own = overtime
      ? humanAttempt.status === "finished"
        ? "Solved in overtime. It does not count toward the result."
        : `Overtime. This ${unit} already counts as unsolved; finish it for practice${snapshot.hasNext.human && length !== "blitz" ? " or move on" : ""}.`
      : humanAttempt.status === "finished"
        ? `Solved in ${formatClock(snapshot.attemptMs.human)}, ${humanAttempt.state.actions} taps.`
        : humanAttempt.status === "time-cap"
          ? `Out of time. This ${unit} counts as unsolved. You can still keep solving it.`
          : humanAttempt.status === "action-cap"
            ? `Tap limit reached. This ${unit} counts as unsolved.`
            : null
    if (matchOver) return own
    const gap = learnerCursor.index - snapshot.cursors.human.index
    const race = learnerFinished
      ? `${rightName} is done in ${formatClock(spentMs(snapshot.records, "learner"))}. Most boards solved wins, then fewest taps.`
      : gap > 0
        ? `${rightName} is ${gap} ${unit}${gap === 1 ? "" : "s"} ahead.`
        : gap < 0
          ? `You are ${-gap} ${unit}${gap === -1 ? "" : "s"} ahead of ${rightName}.`
          : `${rightName} is on this ${unit} too.`
    return own ? `${own} ${race}` : race
  })()
  // The agent stopped or lost its model while its board is still open.
  const learnerTrouble =
    started &&
    !halted &&
    learnerAttempt.status === "playing" &&
    (rightLearner.trace.phase === "done" ||
      rightLearner.trace.phase === "retrying")
      ? rightLearner.trace.phase === "done"
        ? `${rightName} stopped on this board: ${rightLearner.trace.label}`
        : `${rightName} can't reach its model: ${rightLearner.trace.label}`
      : null
  const roundModel = models.roundModel ?? restored?.model ?? null
  const rivalModel = watching
    ? (models.rivalModel ?? restored?.rivalModel ?? null)
    : null
  // Keep this match in localStorage so a reload lands back here, not on setup.
  useEffect(() => {
    let dirty = true
    const save = () => {
      if (!dirty) return
      dirty = false
      saveMatch({
        finished: matchOver,
        setup,
        dealt,
        source,
        rulesShown: true,
        started: started || paused,
        model: roundModel,
        rivalModel,
        battle: battle.dump(),
        traces: {
          human: watching ? traces.human.getSnapshot() : null,
          learner: traces.learner.getSnapshot(),
        },
      })
    }
    const mark = () => {
      dirty = true
    }
    const flush = () => {
      dirty = true
      save()
    }
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush()
    }
    const off = [
      battle.subscribe(mark),
      traces.human.subscribe(mark),
      traces.learner.subscribe(mark),
    ]
    save()
    const timer = setInterval(save, 1000)
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      clearInterval(timer)
      off.forEach((stop) => stop())
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onHidden)
    }
  }, [
    battle,
    dealt,
    matchOver,
    paused,
    rivalModel,
    roundModel,
    setup,
    source,
    started,
    traces,
    watching,
  ])

  const modelId = models.roundModel ?? models.selectedModel
  const modelMenu = (side: Side) => (
    <AgentModelMenu
      models={models.models}
      value={side === "human" ? models.rivalModel : modelId}
      status={models.status}
      onChange={side === "human" ? chooseRival : chooseModel}
    />
  )
  const humanStatus =
    watching && started ? leftLearner.status : humanAttempt.status
  const roundLine = (side: Side) => {
    const pack = side === "human" ? humanPack : learnerPack
    return `${familyLabel(pack)} · ${roundText(length, snapshot.cursors[side], gameCount, roundsPerGame)}`
  }
  const abilityPill = (label: string) => (
    <span className="ability-pill">{label}</span>
  )
  const roundDots = (side: Side, name: string) => {
    const played = new Set(
      snapshot.records.flatMap((record) => {
        if (record.side !== side) return []
        const at = packs.findIndex((pack) => pack.seed === record.seed)
        return at < 0 ? [] : [at]
      })
    )
    return (
      <RoundStrip
        label={`${name} rounds`}
        packs={packs}
        index={snapshot.cursors[side].index}
        done={played}
        windowed={length === "blitz"}
      />
    )
  }
  const trace = (side: Side) => (
    <AgentTrace
      name={side === "learner" ? rightName : leftName}
      ability={side === "learner" ? rightAbility : leftAbility}
      trace={side === "learner" ? rightLearner.trace : leftLearner.trace}
      live={live && snapshot.attempts[side].status === "playing"}
      boardLabel={(board) =>
        `Board ${board + 1} · ${familyLabel(packs[board])}`
      }
    />
  )
  const handleKeepPlaying = () => {
    if (battle.keepPlaying("human")) setSheetOpen(false)
  }
  const canKeepPlaying =
    !watching && started && humanAttempt.status === "time-cap" && !overtime
  const sharedControl = awaitingResume
    ? {
        label: "Resume match",
        disabled: models.status !== "ready",
        onClick: handleStart,
      }
    : !started
      ? {
          label: "Start both",
          disabled: models.status !== "ready",
          onClick: handleStart,
        }
      : watching
        ? { label: "Watching", disabled: true, onClick: () => {} }
        : null
  const dock = watching ? null : (
    <div className="dock-row">
      {canKeepPlaying ? (
        <button
          type="button"
          className="paper-button icon-text"
          disabled={halted}
          onClick={handleKeepPlaying}
        >
          <Hourglass aria-hidden="true" />
          Keep solving
        </button>
      ) : (
        <>
          <button
            type="button"
            className="paper-button icon-text"
            disabled={
              !live ||
              humanAttempt.status !== "playing" ||
              !humanBoard.affordances.controls.undo
            }
            onClick={() => battle.actions("human").undo()}
            aria-keyshortcuts="z"
          >
            <Undo2 aria-hidden="true" />
            Undo
          </button>
          <button
            type="button"
            className="paper-button icon-text"
            disabled={
              !live ||
              humanAttempt.status !== "playing" ||
              !humanBoard.affordances.controls.clear
            }
            onClick={() => battle.actions("human").clear()}
          >
            <RotateCcw aria-hidden="true" />
            Clear
          </button>
        </>
      )}
      {sharedControl ? null : (
        <button
          type="button"
          className="primary-button"
          data-slot="match-next"
          data-locked={(!humanDone) || undefined}
          disabled={halted || !humanDone || !snapshot.canAdvance.human}
          onClick={() => battle.advance("human")}
        >
          {!humanDone ? <Lock aria-hidden="true" /> : <Play aria-hidden="true" />}
          {nextLabel}
        </button>
      )}
    </div>
  )
  const infoRows = [
    {
      label: "Board",
      value: `${familyLabel(humanPack)} · ${humanPack.n} × ${humanPack.n}`,
    },
    {
      label: "Match",
      value: `${dealTitle(dealt)} · ${LENGTH_COPY[length].label}`,
    },
    { label: "Model", value: modelId ?? "loading" },
    {
      label: "Puzzle no.",
      value:
        snapshot.seeds.human !== snapshot.seeds.learner
          ? `${leftName} ${humanPack.seed} · ${rightName} ${learnerPack.seed}`
          : String(humanPack.seed),
    },
    { label: "Boards", value: source },
    ...(["human", "learner"] as const).map((side) => {
      const cursor = snapshot.cursors[side]
      const group = transferGroup(packs[cursor.index])
      const score = scoreTransfer(snapshot.records, side, group)
      const count = snapshot.records.filter(
        (record) =>
          record.side === side &&
          record.transferGroup === group &&
          record.status === "finished"
      ).length
      const goal = packs.filter((pack) => transferGroup(pack) === group).length
      return {
        label: side === "human" ? leftName : rightName,
        value:
          score.eligible && score.actionSlope != null
            ? `taps ${score.actionSlope <= 0 ? "down" : "up"} ${Math.abs(score.actionSlope).toFixed(1)} per round${score.actionsFalling ? " · getting quicker" : ""}`
            : `${count} of ${goal} rounds solved in this family`,
      }
    }),
  ]
  return (
    <main
      className="battle-ground is-battle"
      data-match-over={matchOver || undefined}
      data-sheet={(humanFinished && sheetOpen) || undefined}
      data-results={humanFinished ? (sheetOpen ? "open" : "folded") : undefined}
    >
      <a className="skip-link" href="#boards">
        Skip to boards
      </a>
      <header className="battle-bar">
        <button
          type="button"
          className="icon-button"
          aria-label="Back to setup"
          title="Back to setup"
          onClick={() => {
            if (armed && !matchOver) setLeave(true)
            else onSetup()
          }}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="battle-tools">
          <ThemeToggle />
          <MatchInfo rows={infoRows} />
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettings(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
        </div>
      </header>
      {sharedControl ? (
        <SharedFloat
          key={sharedControl.label}
          label={sharedControl.label}
          disabled={sharedControl.disabled}
          onClick={sharedControl.onClick}
        />
      ) : null}
      <div className="phones" id="boards">
        <Phone
          side="human"
          name={leftName}
          titleExtra={
            watching ? (
              <>
                {mixUsesLanguageModel(leftMix) ? modelMenu("human") : null}
                {abilityPill(leftAbility)}
              </>
            ) : null
          }
          sub={roundLine("human")}
          clock={formatClock(snapshot.remainingMs.human)}
          rounds={roundDots("human", leftName)}
          done={humanDone && humanStatus === "finished"}
          footer={
            <>
              {dock}
              {paceNote ? (
                <p className="pace-note" aria-live="polite">
                  {paceNote}
                </p>
              ) : null}
              {watching ? trace("human") : null}
              <Rules pack={humanPack} />
            </>
          }
        >
          <BoardStage
            board={humanBoard}
            started={started}
            interactive={!watching}
            invalidIndex={showInvalid ? lastCell : null}
            name={leftName}
            locked={awaitingResume}
            coverText="Tap to peek."
            onTap={handleTap}
            onPathStep={handlePathStep}
          />
        </Phone>
        <Phone
          side="learner"
          name={rightName}
          titleExtra={
            <>
              {mixUsesLanguageModel(rightMix) ? modelMenu("learner") : null}
              {abilityPill(rightAbility)}
            </>
          }
          sub={roundLine("learner")}
          clock={formatClock(snapshot.remainingMs.learner)}
          rounds={roundDots("learner", rightName)}
          behind={!watching && humanDone && learnerAttempt.status === "playing"}
          footer={
            <>
              {learnerTrouble ? (
                <p className="agent-trouble" role="status">
                  {learnerTrouble}
                </p>
              ) : null}
              {trace("learner")}
              <Rules pack={learnerPack} />
            </>
          }
        >
          <BoardStage
            board={learnerBoard}
            started={started}
            interactive={false}
            invalidIndex={null}
            name={rightName}
            locked={awaitingResume}
            coverText="Tap to peek."
            onTap={() => {}}
          />
        </Phone>
      </div>
      <AgentPip
        active={started && !humanFinished && !snapshot.matchComplete}
        name={rightName}
        clock={formatClock(snapshot.remainingMs.learner)}
        line={roundText(length, learnerCursor, gameCount, roundsPerGame)}
        board={learnerBoard}
      />
      {humanFinished ? (
        <MatchResults
          open={sheetOpen}
          onToggle={() => setSheetOpen((value) => !value)}
          matchOver={matchOver}
          watching={watching}
          length={length}
          winner={winner}
          leftName={leftName}
          rightName={rightName}
          progress={`${rightName} is on ${roundText(length, learnerCursor, gameCount, roundsPerGame).toLowerCase()}`}
          packs={packs}
          solutions={dealt.solutions}
          records={snapshot.records}
          live={{
            human: {
              seed: snapshot.seeds.human,
              cells: humanAttempt.state.cells,
              actions: humanAttempt.state.actions,
              elapsedMs: snapshot.attemptMs.human,
              status: humanAttempt.status,
            },
            learner: {
              seed: snapshot.seeds.learner,
              cells: learnerAttempt.state.cells,
              actions: learnerAttempt.state.actions,
              elapsedMs: snapshot.attemptMs.learner,
              status: learnerAttempt.status,
            },
          }}
          tallies={{ human: humanTally, learner: learnerTally }}
          times={{
            human: formatClock(
              length === "blitz"
                ? snapshot.remainingMs.human
                : spentMs(snapshot.records, "human")
            ),
            learner: formatClock(
              length === "blitz"
                ? snapshot.remainingMs.learner
                : spentMs(snapshot.records, "learner")
            ),
          }}
          traces={{ human: leftLearner.trace, learner: rightLearner.trace }}
          sameFamilyLabel={sameFamilyLabel}
          onRematch={onRematch}
          onKeepPlaying={canKeepPlaying ? handleKeepPlaying : undefined}
          onNextFamily={onNextFamily}
          onSetup={onSetup}
        />
      ) : null}
      <AlertDialog.Root open={leaveOpen} onOpenChange={setLeave}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="trace-backdrop" />
          <AlertDialog.Popup className="settings-sheet confirm-sheet">
            <AlertDialog.Title className="trace-title">
              Leave this match?
            </AlertDialog.Title>
            <AlertDialog.Description className="trace-description">
              Clocks are paused. Leaving ends the match for both sides, with no
              result.
            </AlertDialog.Description>
            <div className="confirm-actions">
              <AlertDialog.Close className="paper-button">
                Keep playing
              </AlertDialog.Close>
              <button
                type="button"
                className="primary-button"
                onClick={onSetup}
              >
                Leave match
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <MatchSettings
        open={settingsOpen}
        onOpenChange={setSettings}
        arena={arena}
        length={length}
        leftMix={leftMix}
        rightMix={rightMix}
        servers={servers}
        paused={halted}
        live={armed && !matchOver}
        onLeftMix={onLeftMix}
        onRightMix={onRightMix}
        onRestart={onRestart}
      />
    </main>
  )
}
