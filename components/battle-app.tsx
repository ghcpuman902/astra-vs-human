"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { ArrowLeft, Play, RefreshCw, RotateCcw, SlidersHorizontal, Undo2 } from "lucide-react"

import { AgentTrace } from "@/components/agent-trace"
import {
  BoardStage,
  Phone,
  Rules,
  statusWord,
} from "@/components/lovable/battle-field"
import {
  LENGTH_COPY,
  modeName,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { MatchInfo, MatchSettings } from "@/components/match-settings"
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

const blitzLine = (
  humanName: string,
  learnerName: string,
  human: ReturnType<typeof tallyBlitz>,
  learner: ReturnType<typeof tallyBlitz>
) => {
  const winner = compareBlitz(human, learner)
  const side = (name: string, tally: ReturnType<typeof tallyBlitz>) =>
    `${name} ${tally.rounds} boards, ${tally.actions} taps`
  const summary = `${side(humanName, human)}. ${side(learnerName, learner)}.`
  if (winner === "tie") return `Tie. ${summary}`
  return `${winner === "human" ? humanName : learnerName} ahead. ${summary}`
}

const spentMs = (records: readonly BattleRecord[], side: Side) =>
  records
    .filter((record) => record.side === side)
    .reduce((sum, record) => sum + record.elapsedMs, 0)

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
  if (mounted && checked && !dealt && !preview)
    setPreview(dealFor(length, marks))
  const play = (next: DealtMatch, label = "fresh local boards") => {
    clearMatch()
    models.endRound(MATCH_ID)
    setResume(null)
    rememberDeal(next)
    setDealt(next)
    setSource(label)
    setSession((value) => value + 1)
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
        onLength={(next) => {
          setLength(next)
          setPreview(dealFor(next, marks))
        }}
        onRespawn={() => setPreview(dealFor(length, marks, preview?.familyId))}
        onPlay={() => {
          const next = preview ?? dealFor(length, marks)
          setPreview(null)
          play(next)
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
      onSetup={() => {
        clearMatch()
        models.endRound(MATCH_ID)
        setResume(null)
        setDealt(null)
      }}
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
  const { getModel, endRound, startRound, chooseModel } = models
  const [started, setStarted] = useState(() => Boolean(restored?.finished))
  const awaitingResume = paused && !started
  const watching = arena === "watch"
  const [lastCell, setLastCell] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  // Settings open: both clocks and both agents hold still until it closes.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [halted, setHalted] = useState(false)
  const humanPack = packs[snapshot.cursors.human.index]
  const learnerPack = packs[snapshot.cursors.learner.index]
  const humanDone = started && snapshot.attempts.human.status !== "playing"
  const armed = started && !snapshot.matchComplete
  const live = started && !halted
  const leftLearner = useSideLearner({
    enabled: watching,
    side: "human",
    battle,
    packs,
    started: live,
    mix: leftMix,
    getModel,
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
  useEffect(() => {
    if (restoredModel && models.status === "ready") chooseModel(restoredModel)
  }, [chooseModel, models.status, restoredModel])
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

  const setSettings = (open: boolean) => {
    if (open) {
      if (battle.pause()) setHalted(true)
    } else if (halted) {
      battle.start()
      setHalted(false)
    }
    setSettingsOpen(open)
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
    snapshot.attempts.human.status !== "playing" &&
    snapshot.attempts.learner.status !== "playing" &&
    !snapshot.canAdvance.human &&
    !snapshot.canAdvance.learner
  const blitzResult = blitzDone
    ? blitzLine(
        leftName,
        rightName,
        tallyBlitz(snapshot.records, "human", snapshot.remainingMs.human),
        tallyBlitz(snapshot.records, "learner", snapshot.remainingMs.learner)
      )
    : null
  const nextLabel = !snapshot.hasNext.human
    ? "Match complete"
    : length === "tour"
      ? "Next family"
      : length === "blitz"
        ? "Next board"
        : "Next round"
  // A side is finished when its attempt ended and nothing is left to advance to.
  const sideFinished = (side: Side) =>
    started &&
    snapshot.attempts[side].status !== "playing" &&
    !snapshot.canAdvance[side]
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
  const youName = watching ? leftName : "You"
  const headline = !matchOver
    ? `${youName} finished`
    : winner === "tie"
      ? "Tie"
      : winner === "human"
        ? watching
          ? `${leftName} wins`
          : "You win"
        : `${rightName} wins`
  const learnerCursor = snapshot.cursors.learner
  const roundModel = models.roundModel ?? restored?.model ?? null
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
    roundModel,
    setup,
    source,
    started,
    traces,
    watching,
  ])

  const modelId = models.roundModel ?? models.selectedModel
  const modelLabel =
    models.models.find((model) => model.id === modelId)?.label ?? "Agent"
  const humanStatus =
    watching && started ? leftLearner.status : humanAttempt.status
  const tapLine = (actions: number, status: string) =>
    `${actions} taps${started ? ` · ${statusWord(status)}` : ""}`
  const roundDots = (side: Side) => {
    if (length === "blitz") return null
    const cursor = snapshot.cursors[side]
    return (
      <ol className="small-rounds" aria-label={`${side} rounds`}>
        {packs.map((pack, index) => {
          const done = snapshot.records.some(
            (record) => record.side === side && record.seed === pack.seed
          )
          const current = cursor.index === index
          return (
            <li
              key={pack.seed}
              className="small-round"
              data-current={current || undefined}
              data-done={done || undefined}
              title={familyLabel(pack)}
            />
          )
        })}
      </ol>
    )
  }
  const trace = (side: Side) => (
    <AgentTrace
      name={side === "learner" ? rightName : leftName}
      ability={side === "learner" ? rightAbility : leftAbility}
      trace={side === "learner" ? rightLearner.trace : leftLearner.trace}
      live={live && snapshot.attempts[side].status === "playing"}
      boardLabel={(board) => `Board ${board + 1} · ${familyLabel(packs[board])}`}
    />
  )
  const dock = (
    <div className="dock-row">
      {watching ? null : (
        <>
          <button
            type="button"
            className="paper-button icon-text"
            disabled={
              !live ||
              humanAttempt.status !== "playing" ||
              !humanAttempt.state.history.length
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
            disabled={!live || humanAttempt.status !== "playing"}
            onClick={() => battle.actions("human").clear()}
          >
            <RotateCcw aria-hidden="true" />
            Clear
          </button>
        </>
      )}
      <button
        type="button"
        className="primary-button"
        data-slot="match-next"
        disabled={
          (watching && started) ||
          (!started
            ? models.status !== "ready"
            : halted || !humanDone || !snapshot.canAdvance.human)
        }
        onClick={() => {
          if (!started) handleStart()
          else battle.advance("human")
        }}
      >
        <Play aria-hidden="true" />
        {awaitingResume
          ? "Resume match"
          : !started
            ? "Start both"
            : watching
              ? "Watching"
              : nextLabel}
      </button>
    </div>
  )
  const infoRows = [
    {
      label: "Board",
      value: `${familyLabel(humanPack)} · ${humanPack.n} × ${humanPack.n}`,
    },
    { label: "Match", value: `${dealTitle(dealt)} · ${LENGTH_COPY[length].label}` },
    { label: "Model", value: modelId ?? "loading" },
    {
      label: "Seed",
      value:
        snapshot.seeds.human !== snapshot.seeds.learner
          ? `${leftName} ${humanPack.seed} · ${rightName} ${learnerPack.seed}`
          : String(humanPack.seed),
    },
    { label: "Source", value: source },
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
        value: score.eligible
          ? `action slope ${score.actionSlope?.toFixed(1)} per round${score.actionsFalling ? " · falling" : ""}`
          : `${count}/${goal} transfer rounds`,
      }
    }),
  ]
  return (
    <main
      className="battle-ground is-battle"
      data-match-over={matchOver || undefined}
      data-sheet={(humanFinished && sheetOpen) || undefined}
    >
      <a className="skip-link" href="#boards">
        Skip to boards
      </a>
      <header className="battle-bar">
        <button
          type="button"
          className="icon-button"
          disabled={armed && !humanFinished}
          aria-label="Back to setup"
          title={
            armed && !humanFinished
              ? "Finish or wait for the match to end"
              : "Back to setup"
          }
          onClick={onSetup}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="battle-tools">
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
      <div className="phones" id="boards">
        <Phone
          side="human"
          name={leftName}
          sub={`${familyLabel(humanPack)} · ${roundText(length, snapshot.cursors.human, gameCount, roundsPerGame)}`}
          clock={formatClock(snapshot.remainingMs.human)}
          tally={tapLine(humanAttempt.state.actions, humanStatus)}
          rounds={roundDots("human")}
          done={humanDone && humanStatus === "finished"}
          footer={
            <>
              {dock}
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
          sub={`${modelLabel} · ${rightAbility}`}
          clock={formatClock(snapshot.remainingMs.learner)}
          tally={tapLine(learnerAttempt.state.actions, learnerAttempt.status)}
          rounds={roundDots("learner")}
          behind={!watching && humanDone && learnerAttempt.status === "playing"}
          footer={trace("learner")}
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
      {humanFinished ? (
        <section
          className="match-results"
          role="region"
          aria-label="Match results"
          aria-live="polite"
          data-open={sheetOpen || undefined}
        >
          <button
            type="button"
            className="results-grip"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((value) => !value)}
          >
            <span className="results-headline">
              <strong>{headline}</strong>
              <span>
                {matchOver
                  ? sheetOpen
                    ? "Hide to see the boards"
                    : "Show results"
                  : `${rightName} is on ${roundText(length, learnerCursor, gameCount, roundsPerGame).toLowerCase()}`}
              </span>
            </span>
          </button>
          <div className="results-body" hidden={!sheetOpen}>
            <table className="results-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Side</span>
                  </th>
                  <th scope="col">Boards</th>
                  <th scope="col">Taps</th>
                  <th scope="col">{length === "blitz" ? "Left" : "Time"}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["human", leftName, humanTally],
                    ["learner", rightName, learnerTally],
                  ] as const
                ).map(([side, name, tally]) => (
                  <tr
                    key={side}
                    data-winner={(matchOver && winner === side) || undefined}
                  >
                    <th scope="row">
                      {name}
                      {!sideFinished(side) ? (
                        <span className="results-live"> · playing</span>
                      ) : null}
                    </th>
                    <td>
                      {tally.rounds}/{packs.length}
                    </td>
                    <td>{tally.actions}</td>
                    <td>
                      {formatClock(
                        length === "blitz"
                          ? snapshot.remainingMs[side]
                          : spentMs(snapshot.records, side)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blitzResult ? (
              <p className="results-blitz">{blitzResult}</p>
            ) : null}
            <div className="results-actions">
              <button
                type="button"
                className="primary-button"
                onClick={onRematch}
              >
                <RefreshCw aria-hidden="true" />
                {sameFamilyLabel ? `Rematch ${sameFamilyLabel}` : "Rematch"}
              </button>
              {length === "deep" ? (
                <button
                  type="button"
                  className="paper-button"
                  onClick={onNextFamily}
                >
                  Next family
                </button>
              ) : null}
              <button type="button" className="paper-button" onClick={onSetup}>
                Back to setup
              </button>
            </div>
          </div>
        </section>
      ) : null}
      <MatchSettings
        open={settingsOpen}
        onOpenChange={setSettings}
        arena={arena}
        length={length}
        leftMix={leftMix}
        rightMix={rightMix}
        servers={servers}
        model={models}
        paused={halted}
        onLeftMix={onLeftMix}
        onRightMix={onRightMix}
        onRestart={onRestart}
        onSetup={onSetup}
      />
    </main>
  )
}
