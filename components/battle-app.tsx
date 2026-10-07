"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  ArrowLeft,
  Bot,
  Check,
  Crown,
  LayoutGrid,
  Lightbulb,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Timer,
  Undo2,
  User,
  Waypoints,
} from "lucide-react"

import { AgentTrace } from "@/components/agent-trace"
import { BattleField, statusWord } from "@/components/lovable/battle-field"
import { MiniBoard } from "@/components/lovable/mini-board"
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
import {
  matchFamilies,
  type FamilyMarks,
  type MatchFamily,
} from "@/lib/battle-ground-ui/family-bias"
import {
  learnerModeIds,
  type LearnerMixId,
} from "@/lib/battle-ground-ui/learner-mix"
import {
  DEFAULT_MATCH_LENGTH,
  freshDeal,
  MATCH_LENGTHS,
  type DealtMatch,
  type MatchLength,
} from "@/lib/battle-ground-ui/match-deck"
import {
  clearMatch,
  readMatch,
  saveMatch,
  type SavedMatch,
} from "@/lib/match-memory"
import { packSchema, type GamePack } from "@/lib/mini-game-rules/schema"
import { verifyGame } from "@/lib/mini-game-rules/verifier"

const MATCH_ID = "match"
const FALLBACK_NAMES: Record<GamePack["category"], string> = {
  binary_fill: "Summer Moons",
  crown: "Crown seats",
  path_cover: "Number trail",
  tile_rotate_connect: "Pipe turn",
  lights_toggle: "Cross lights",
}
const familyLabel = (pack: GamePack) => {
  const hit = matchFamilies().find(
    (family) => family.id === pack.transfer.family
  )
  return hit?.label ?? FALLBACK_NAMES[pack.category]
}
const ModeIcon = ({ length }: { length: MatchLength }) => {
  if (length === "deep")
    return (
      <span className="mode-icon" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className="mode-dot same" />
        ))}
      </span>
    )
  if (length === "tour")
    return (
      <span className="mode-icon" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className={`mode-dot hue-${i}`} />
        ))}
      </span>
    )
  return (
    <span className="mode-icon blitz" aria-hidden="true">
      <Timer />
    </span>
  )
}
const FamilyIcon = ({ family }: { family: MatchFamily }) => {
  const common = { className: "family-icon", "aria-hidden": true as const }
  switch (family.icon) {
    case "sun-moon":
      return (
        <span className="family-icon-pair" aria-hidden="true">
          <Sparkles {...common} />
          <Moon {...common} />
        </span>
      )
    case "crown":
    case "sparse":
      return <Crown {...common} />
    case "path":
      return <Waypoints {...common} />
    case "pipe":
      return <LayoutGrid {...common} />
    case "lights":
    case "cascade":
      return <Lightbulb {...common} />
    case "islands":
      return <Sparkles {...common} />
    default:
      return <LayoutGrid {...common} />
  }
}
type Generated = {
  pack: GamePack
  meta: { source: string; contentHash: string; elapsedMs: number }
}
type Servers = {
  openai: boolean
  gateway: boolean
  jev: boolean
  laya: boolean
}

const LENGTH_COPY: Record<MatchLength, { label: string; hint: string }> = {
  deep: {
    label: "Deep",
    hint: "One family, five boards.",
  },
  tour: {
    label: "Tour",
    hint: "One board from each family.",
  },
  blitz: {
    label: "Blitz",
    hint: "3 min each. Most boards wins.",
  },
}

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

const formatClock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

const spentMs = (records: readonly BattleRecord[], side: Side) =>
  records
    .filter((record) => record.side === side)
    .reduce((sum, record) => sum + record.elapsedMs, 0)

const dealTitle = (dealt: DealtMatch) => {
  if (dealt.length === "deep") return familyLabel(dealt.packs[0])
  if (dealt.length === "tour") return `${dealt.packs.length} families`
  return `${dealt.packs.length} boards, 3 min`
}

export function BattleApp() {
  const mounted = useMounted()
  const memory = useDealMemory()
  const [arena, setArena] = useState<"play" | "watch">("play")
  const [leftMix, setLeftMix] = useState<LearnerMixId>("astra")
  const [rightMix, setRightMix] = useState<LearnerMixId>("astra")
  const [length, setLength] = useState<MatchLength>(DEFAULT_MATCH_LENGTH)
  const [marks, setMarks] = useState<FamilyMarks>({ played: [], disliked: [] })
  const [preview, setPreview] = useState<DealtMatch | null>(null)
  const [dealt, setDealt] = useState<DealtMatch | null>(null)
  const [practice, setPractice] = useState(false)
  const [session, setSession] = useState(0)
  const [source, setSource] = useState("fresh local boards")
  const [servers, setServers] = useState<Servers | null>(null)
  // A match saved in this browser before a reload, read once after mount.
  const [checked, setChecked] = useState(false)
  const [resume, setResume] = useState<SavedMatch | null>(null)
  const avoid = useMemo(() => new Set(memory.boards), [memory.boards])
  const setup = useMemo(
    () => ({ arena, leftMix, rightMix, length, marks, practice }),
    [arena, leftMix, rightMix, length, marks, practice]
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
      setPractice(saved.setup.practice)
      setSource(saved.source)
      setDealt(saved.dealt)
      setResume(saved)
    }
  }
  if (mounted && checked && !dealt && !preview)
    setPreview(dealFor(length, marks))
  const play = (next: DealtMatch, label = "fresh local boards") => {
    clearMatch()
    setResume(null)
    rememberDeal(next)
    setDealt(next)
    setSource(label)
    setSession((value) => value + 1)
  }
  if (!dealt) {
    return (
      <FamilyGate
        arena={arena}
        leftMix={leftMix}
        rightMix={rightMix}
        length={length}
        marks={marks}
        preview={preview}
        servers={servers}
        onArena={setArena}
        onLeftMix={setLeftMix}
        onRightMix={setRightMix}
        onLength={(next) => {
          setLength(next)
          setPreview(dealFor(next, marks))
        }}
        onMarks={(next) => {
          setMarks(next)
          setPreview(dealFor(length, next))
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
  const packs = dealt.packs
  return (
    <BattleSession
      key={`${session}:${practice}`}
      dealt={dealt}
      arena={arena}
      leftMix={leftMix}
      rightMix={rightMix}
      practice={practice}
      source={source}
      servers={servers}
      resume={resume}
      setup={setup}
      onPractice={() => setPractice((value) => !value)}
      onRematch={() => play(dealFor(dealt.length, marks, dealt.familyId))}
      onNextFamily={() => play(dealFor("deep", marks))}
      onSetup={() => {
        clearMatch()
        setResume(null)
        setDealt(null)
      }}
      onInvent={(pack, label) => {
        const next = dealFor(dealt.length, marks, dealt.familyId)
        const rest = next.packs
          .slice(1)
          .filter((item) => item.seed !== pack.seed)
        if (rest.length !== next.packs.length - 1) return
        play({ ...next, packs: [pack, ...rest] }, label)
      }}
      sameFamilyLabel={dealt.length === "deep" ? familyLabel(packs[0]) : null}
    />
  )
}

const mixCopy: Record<
  (typeof learnerModeIds)[number],
  { label: string; detail: string }
> = {
  astra: {
    label: "Astra",
    detail:
      "Same public board as you. Astra names one cell or a short burst of taps.",
  },
  code: {
    label: "Code",
    detail:
      "Astra writes a tiny policy. This browser runs it. No JavaScript is eval'd.",
  },
  "astra-jev": {
    label: "Astra + Jev",
    detail:
      "Astra writes the plan and captions. Jev commits wait/one/batch when a Jev credential is set. Prefer this over bare Jev.",
  },
  "jev-bare": {
    label: "Jev bare",
    detail:
      "Control only: Jev sees the public board with no Astra plan. Scored play should use Astra + Jev.",
  },
  "astra-laya": {
    label: "Astra + Laya",
    detail:
      "Astra writes the plan as context. Laya commits it when a Laya credential is set.",
  },
  "laya-bare": {
    label: "Laya bare",
    detail:
      "Laya sees the public board only. No Astra plan is wrapped around it.",
  },
  "openai-decisions": {
    label: "OpenAI Decisions",
    detail:
      "Astra or Sol writes a short plan and captions. Decisions picks the single next tap — never a bare board.",
  },
}

function modeNote(mix: LearnerMixId, servers: Servers | null) {
  if (!servers) return ""
  if (mix === "openai-decisions") {
    return servers.openai || servers.gateway
      ? "Decisions runs planner-wrapped on this server."
      : "OpenAI Decisions is not configured, so this side waits."
  }
  if (mix === "jev-bare" || mix === "astra-jev") {
    return servers.jev
      ? "Jev can run on this server."
      : "Jev is not configured, so this side waits."
  }
  if (mix === "laya-bare" || mix === "astra-laya") {
    return servers.laya
      ? "Laya can run on this server."
      : "Laya is not configured, so this side waits."
  }
  if (!servers.openai && !servers.gateway)
    return "No Astra credential is set, so this side waits."
  return ""
}

function ModePicker({
  legend,
  name,
  mix,
  servers,
  onMix,
}: {
  legend: string
  name: string
  mix: LearnerMixId
  servers: Servers | null
  onMix: (mix: LearnerMixId) => void
}) {
  const note = modeNote(mix, servers)
  const copy = mixCopy[mix as (typeof learnerModeIds)[number]] ?? mixCopy.astra
  return (
    <fieldset className="setup-group">
      <legend>{legend}</legend>
      <div className="chip-row">
        {learnerModeIds.map((id) => (
          <label key={id} className="option-chip">
            <input
              type="radio"
              name={name}
              value={id}
              checked={mix === id}
              onChange={() => onMix(id)}
            />
            <Check className="chip-check" aria-hidden="true" />
            {mixCopy[id].label}
          </label>
        ))}
      </div>
      <p className="setup-note" aria-live="polite">
        {copy.detail}
        {note ? ` ${note}` : ""}
      </p>
    </fieldset>
  )
}

function UpNext({
  preview,
  onRespawn,
}: {
  preview: DealtMatch | null
  onRespawn: () => void
}) {
  const [turns, setTurns] = useState(0)
  const first = preview?.packs[0]
  return (
    <section className="up-next" aria-label="Next match" aria-live="polite">
      <div className="up-next-board">
        {first ? (
          <div key={first.seed} className="board-swap">
            <MiniBoard pack={first} />
          </div>
        ) : (
          <div className="mini-board-skeleton" />
        )}
      </div>
      <div className="up-next-copy">
        <strong>{preview ? dealTitle(preview) : "Dealing…"}</strong>
        <span>
          {preview
            ? preview.length === "deep"
              ? `${first?.n} × ${first?.n} · ${preview.packs.length} fresh boards`
              : `Starts with ${familyLabel(preview.packs[0])}`
            : "Assembling fresh boards"}
        </span>
      </div>
      <button
        type="button"
        className="paper-button respawn-button"
        disabled={!preview}
        aria-label="Respawn: assemble new boards"
        onClick={() => {
          setTurns((value) => value + 1)
          onRespawn()
        }}
      >
        <RefreshCw
          className="respawn-icon"
          style={{ rotate: `${turns * 180}deg` }}
          aria-hidden="true"
        />
        <span className="hide-narrow">Respawn</span>
      </button>
    </section>
  )
}

function FamilyGate({
  arena,
  leftMix,
  rightMix,
  length,
  marks,
  preview,
  servers,
  onArena,
  onLeftMix,
  onRightMix,
  onLength,
  onMarks,
  onRespawn,
  onPlay,
}: {
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  marks: FamilyMarks
  preview: DealtMatch | null
  servers: Servers | null
  onArena: (arena: "play" | "watch") => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onLength: (length: MatchLength) => void
  onMarks: (marks: FamilyMarks) => void
  onRespawn: () => void
  onPlay: () => void
}) {
  const families = matchFamilies()
  const toggle = (id: string, kind: "played" | "disliked") => {
    const selected = marks[kind]
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id]
    onMarks({ ...marks, [kind]: next })
  }
  const watching = arena === "watch"
  return (
    <main className="battle-ground is-setup">
      <a className="skip-link" href="#start-match">
        Skip to start
      </a>
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay()
        }}
      >
        <div className="setup-main">
          <header className="setup-intro">
            <p className="wordmark">astra-vs-human</p>
            <h1>Same rules. Two clocks.</h1>
            <p>
              Pick who plays and how long. Every start deals boards nobody has
              seen in this browser.
            </p>
          </header>
          <fieldset className="setup-group">
            <legend>Who plays</legend>
            <div className="option-grid two">
              <label className="option-card">
                <input
                  type="radio"
                  name="arena"
                  value="play"
                  checked={arena === "play"}
                  onChange={() => onArena("play")}
                />
                <span className="option-art" aria-hidden="true">
                  <User /> <span>vs</span> <Bot />
                </span>
                <strong>You vs Agent</strong>
                <span className="option-note">You play the left board.</span>
                <Check className="option-check" aria-hidden="true" />
              </label>
              <label className="option-card">
                <input
                  type="radio"
                  name="arena"
                  value="watch"
                  checked={arena === "watch"}
                  onChange={() => onArena("watch")}
                />
                <span className="option-art" aria-hidden="true">
                  <Bot /> <span>vs</span> <Bot />
                </span>
                <strong>Agent vs Agent</strong>
                <span className="option-note">You watch both clocks.</span>
                <Check className="option-check" aria-hidden="true" />
              </label>
            </div>
          </fieldset>
          <fieldset className="setup-group">
            <legend>Match length</legend>
            <div className="option-grid three">
              {MATCH_LENGTHS.map((id) => (
                <label key={id} className="option-card length-option">
                  <input
                    type="radio"
                    name="length"
                    value={id}
                    checked={length === id}
                    onChange={() => onLength(id)}
                  />
                  <ModeIcon length={id} />
                  <strong>{LENGTH_COPY[id].label}</strong>
                  <span className="option-note">{LENGTH_COPY[id].hint}</span>
                  <Check className="option-check" aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
          {watching ? (
            <>
              <ModePicker
                legend="Agent A"
                name="mix-a"
                mix={leftMix}
                servers={servers}
                onMix={onLeftMix}
              />
              <ModePicker
                legend="Agent B"
                name="mix-b"
                mix={rightMix}
                servers={servers}
                onMix={onRightMix}
              />
            </>
          ) : (
            <ModePicker
              legend="Agent ability"
              name="mix"
              mix={rightMix}
              servers={servers}
              onMix={onRightMix}
            />
          )}
          <fieldset className="setup-group">
            <legend>Families you already know</legend>
            <p className="setup-note">
              New families come first. Less sends one to the back.
            </p>
            <ul className="family-list">
              {families.map((family) => (
                <li
                  key={family.id}
                  className="family-row"
                  data-demoted={family.demote || undefined}
                >
                  <FamilyIcon family={family} />
                  <div className="family-copy">
                    <strong>
                      {family.label}
                      <span className="family-spirit">
                        {family.n}×{family.n}
                        {family.spirit ? ` · ${family.spirit}` : ""}
                        {family.demote ? " · demoted" : ""}
                      </span>
                    </strong>
                    <p>{family.pattern}</p>
                  </div>
                  <div className="family-marks">
                    <label className="option-chip small">
                      <input
                        type="checkbox"
                        checked={marks.played.includes(family.id)}
                        aria-label={`Played ${family.label}`}
                        onChange={() => toggle(family.id, "played")}
                      />
                      <Check className="chip-check" aria-hidden="true" />
                      Played
                    </label>
                    <label className="option-chip small">
                      <input
                        type="checkbox"
                        checked={marks.disliked.includes(family.id)}
                        aria-label={`Less of ${family.label}`}
                        onChange={() => toggle(family.id, "disliked")}
                      />
                      <Check className="chip-check" aria-hidden="true" />
                      Less
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
        <aside className="setup-side">
          <UpNext preview={preview} onRespawn={onRespawn} />
          <button
            id="start-match"
            type="submit"
            className="primary-button start-button"
            disabled={!preview}
          >
            <Play aria-hidden="true" />
            Start match
          </button>
        </aside>
      </form>
    </main>
  )
}

function BattleSession({
  dealt,
  arena,
  leftMix,
  rightMix,
  practice,
  source,
  servers,
  resume,
  setup,
  sameFamilyLabel,
  onPractice,
  onRematch,
  onNextFamily,
  onSetup,
  onInvent,
}: {
  dealt: DealtMatch
  resume: SavedMatch | null
  setup: SavedMatch["setup"]
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  practice: boolean
  source: string
  servers: Servers | null
  sameFamilyLabel: string | null
  onPractice: () => void
  onRematch: () => void
  onNextFamily: () => void
  onSetup: () => void
  onInvent: (pack: GamePack, label: string) => void
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
      practice,
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
  const models = useLearnerModel()
  const { getModel, endRound, startRound, selectModel } = models
  const [started, setStarted] = useState(() => Boolean(restored?.finished))
  const [rulesShown, setRulesShown] = useState(
    () => restored?.rulesShown ?? false
  )
  const awaitingResume = paused && !started
  const watching = arena === "watch"
  const [lastCell, setLastCell] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const humanPack = packs[snapshot.cursors.human.index]
  const learnerPack = packs[snapshot.cursors.learner.index]
  const humanDone = started && snapshot.attempts.human.status !== "playing"
  const learnerPlaying =
    started && snapshot.attempts.learner.status === "playing"
  const armed = started && !snapshot.matchComplete
  const leftLearner = useSideLearner({
    enabled: watching,
    side: "human",
    battle,
    packs,
    started,
    mix: leftMix,
    getModel,
    trace: traces.human,
  })
  const rightLearner = useSideLearner({
    enabled: true,
    side: "learner",
    battle,
    packs,
    started,
    mix: rightMix,
    getModel,
    trace: traces.learner,
  })
  const agentStatus = rightLearner.status
  const claim = rightLearner.claim
  const modeName = (mix: LearnerMixId) =>
    mixCopy[mix as (typeof learnerModeIds)[number]]?.label ?? "Astra"
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

  /** Sol (or the local engine when no key is set) invents one board for a rematch. */
  async function invent() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/game-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: crypto.getRandomValues(new Uint32Array(1))[0],
          n: packs[0].n,
          preferences: {
            categories: [packs[0].category],
            visibility: "full",
            targetSeconds: packs[0].session.targetSeconds,
          },
        }),
        signal: AbortSignal.timeout(60000),
      })
      const result = (await response.json()) as Generated & { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? "Generation did not finish. Try again.")
      const next = packSchema.parse(result.pack)
      if (next.category !== packs[0].category)
        throw new Error("The generator returned another game category.")
      onInvent(
        {
          ...next,
          transfer: { ...next.transfer, family: packs[0].transfer.family },
        },
        `${result.meta.source} · ${(result.meta.elapsedMs / 1000).toFixed(1)}s`
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not generate a pack."
      )
    } finally {
      setBusy(false)
    }
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
    if (restored?.model) selectModel(restored.model)
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
  const handleNext = () => {
    if (!battle.advance("human")) return
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
        rulesShown,
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
    rulesShown,
    setup,
    source,
    started,
    traces,
    watching,
  ])
  const phase = !rulesShown ? "rules" : !started ? "start" : "next"
  const sides = [
    {
      side: "human" as const,
      label: leftName,
      ability: leftAbility,
      status: watching ? leftLearner.status : statusWord(humanAttempt.status),
    },
    {
      side: "learner" as const,
      label: rightName,
      ability: rightAbility,
      status: agentStatus,
    },
  ]
  const hint = awaitingResume
    ? "Restored after a reload. Both clocks are paused until you resume."
    : watching && started
      ? "You are watching. Each agent keeps its own clock."
      : !rulesShown
        ? "Rules are the same for both players."
        : !started
          ? models.status === "ready"
            ? watching
              ? "Start begins both agent clocks."
              : "Start begins both clocks together."
            : "Learner model is loading."
          : blitzResult
            ? blitzResult
            : length === "blitz" && !humanDone
              ? "Finish this attempt to unlock Next. Your 3:00 keeps running."
              : !humanDone
                ? "Finish this attempt to unlock Next. The agent is not moved."
                : learnerPlaying
                  ? "The agent is still on its round."
                  : snapshot.canAdvance.human
                    ? "Your next board. The agent keeps going."
                    : "Both sides finished this match."
  const dock = (
    <div className="battle-dock" data-phase={phase}>
      <p className="match-hint">{hint}</p>
      <div className="dock-row">
        {watching ? null : (
          <>
            <button
              type="button"
              className="paper-button icon-text"
              disabled={
                !started ||
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
              disabled={!started || humanAttempt.status !== "playing"}
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
          data-phase={!rulesShown ? "rules" : !started ? "start" : "next"}
          disabled={
            busy ||
            (watching && started) ||
            (!rulesShown
              ? false
              : !started
                ? models.status !== "ready"
                : !humanDone || !snapshot.canAdvance.human)
          }
          onClick={() => {
            if (!rulesShown) {
              setRulesShown(true)
              return
            }
            if (!started) {
              handleStart()
              return
            }
            handleNext()
          }}
        >
          <Play aria-hidden="true" />
          {!rulesShown
            ? "Show rules"
            : awaitingResume
              ? "Resume match"
              : !started
                ? "Start both"
                : watching
                  ? "Watching"
                  : nextLabel}
        </button>
      </div>
    </div>
  )
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
        <div className="bar-heading">
          <h1>{familyLabel(humanPack)}</h1>
          <span className="battle-size">
            {humanPack.n} × {humanPack.n}
          </span>
          <span className="mode-badge">{humanPack.mode}</span>
        </div>
        <div className="battle-tools">
          {!started && !paused ? (
            <button
              type="button"
              className="paper-button icon-text"
              onClick={onRematch}
              title="Assemble new boards for this match"
            >
              <RefreshCw aria-hidden="true" />
              <span className="hide-narrow">New boards</span>
            </button>
          ) : null}
          <div className="score-toggle" role="group" aria-label="Scoring">
            <button
              type="button"
              aria-pressed={!practice}
              disabled={armed || paused || busy || !practice}
              onClick={onPractice}
            >
              Scored
            </button>
            <button
              type="button"
              aria-pressed={practice}
              disabled={armed || paused || busy || practice}
              onClick={onPractice}
            >
              Test
            </button>
          </div>
        </div>
      </header>
      <section
        className="scoreboard"
        aria-label="Human and Agent match progress"
      >
        {sides.map(({ side, label, ability, status }) => {
          const cursor = snapshot.cursors[side]
          const agent = side === "learner" || watching
          return (
            <section
              key={side}
              className="score-side"
              data-side={side}
              aria-label={`${label} progress`}
            >
              <div className="score-name">
                <strong>{label}</strong>
                <span className="match-ability">{ability}</span>
              </div>
              <div
                className="match-clock"
                aria-label={
                  length === "blitz"
                    ? `${label} 3 minute clock`
                    : `${label} clock`
                }
              >
                <span className="clock-digits">
                  {formatClock(snapshot.remainingMs[side])}
                </span>
                <span className="clock-tag">
                  {length === "blitz" ? "3 min" : "per board"}
                </span>
              </div>
              <div className="score-progress">
                <span className="match-round">
                  {roundText(length, cursor, gameCount, roundsPerGame)}
                </span>
                {length === "blitz" ? null : (
                  <ol className="small-rounds">
                    {packs.map((pack, index) => {
                      const done = snapshot.records.some(
                        (record) =>
                          record.side === side && record.seed === pack.seed
                      )
                      const current = cursor.index === index
                      return (
                        <li
                          key={pack.seed}
                          className="small-round"
                          data-current={current || undefined}
                          data-done={done || undefined}
                          title={familyLabel(pack)}
                          aria-label={`${label} ${length === "tour" ? familyLabel(pack) : `round ${index + 1}`}${done ? ", done" : current ? ", current" : ""}`}
                        />
                      )
                    })}
                  </ol>
                )}
              </div>
              {agent ? (
                <AgentTrace
                  name={label}
                  ability={ability}
                  trace={
                    side === "learner" ? rightLearner.trace : leftLearner.trace
                  }
                  live={started && snapshot.attempts[side].status === "playing"}
                  boardLabel={(board) =>
                    `Board ${board + 1} · ${familyLabel(packs[board])}`
                  }
                />
              ) : (
                <p className="score-status">{started ? status : "Ready"}</p>
              )}
            </section>
          )
        })}
      </section>
      <BattleField
        pack={humanPack}
        practice={practice}
        started={started}
        finished={started && learnerAttempt.status !== "playing"}
        humanBoard={humanBoard}
        learnerBoard={learnerBoard}
        humanActions={humanAttempt.state.actions}
        learnerActions={learnerAttempt.state.actions}
        humanTitle={leftName}
        learnerTitle={rightName}
        humanInteractive={!watching}
        humanStatus={
          watching && started ? leftLearner.status : humanAttempt.status
        }
        learnerStatus={learnerAttempt.status}
        agentStatus={agentStatus}
        claim={claim}
        invalidIndex={showInvalid ? lastCell : null}
        rulesShown={rulesShown}
        paused={awaitingResume}
        humanDone={humanDone}
        agentWorking={!watching && humanDone && learnerPlaying}
        splitBoards={snapshot.seeds.human !== snapshot.seeds.learner}
        dock={dock}
        onTap={handleTap}
        onPathStep={handlePathStep}
      />
      <footer className="battle-footer">
        <span className="seed">
          {leftName.toUpperCase()} SEED {humanPack.seed}
          {snapshot.seeds.human !== snapshot.seeds.learner
            ? ` · ${rightName.toUpperCase()} SEED ${learnerPack.seed}`
            : ""}
          {source ? ` · ${source}` : ""}
        </span>
        <div className="transfer-line" aria-label="Learning across rounds">
          {practice ? (
            <span>Practice · excluded from scores</span>
          ) : (
            (["human", "learner"] as const).map((side) => {
              const cursor = snapshot.cursors[side]
              const group = transferGroup(packs[cursor.index])
              const score = scoreTransfer(snapshot.records, side, group)
              const count = snapshot.records.filter(
                (record) =>
                  record.side === side &&
                  record.transferGroup === group &&
                  record.status === "finished"
              ).length
              const goal = packs.filter(
                (pack) => transferGroup(pack) === group
              ).length
              return (
                <span key={side}>
                  <strong>{side === "human" ? leftName : rightName}</strong> ·{" "}
                  {familyLabel(packs[cursor.index])} ·{" "}
                  {score.eligible
                    ? `action slope ${score.actionSlope?.toFixed(1)} per round${score.actionsFalling ? " · actions falling" : ""}`
                    : `${count}/${goal} completed transfer rounds`}
                </span>
              )
            })
          )}
        </div>
      </footer>
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
            {error ? (
              <p role="alert" className="battle-error">
                {error}
              </p>
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
              {servers?.openai ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void invent()}
                >
                  {busy ? "Sol is inventing…" : "Invent a board with Sol"}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  )
}
