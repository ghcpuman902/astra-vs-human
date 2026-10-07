"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  Bot,
  Crown,
  LayoutGrid,
  Lightbulb,
  Lock,
  LockOpen,
  Moon,
  Play,
  RefreshCw,
  Sparkles,
  Timer,
  User,
  Waypoints,
} from "lucide-react"

import { BattleField } from "@/components/lovable/battle-field"
import { useLearnerModel } from "@/hooks/use-learner-model"
import { useSideLearner } from "@/hooks/use-side-learner"
import {
  compareBlitz,
  createBattleGround,
  scoreTransfer,
  tallyBlitz,
  transferGroup,
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
  buildFamilyLibrary,
  dealMatch,
  DEFAULT_MATCH_LENGTH,
  MATCH_LENGTHS,
  type FamilyShelf,
  type MatchLength,
} from "@/lib/battle-ground-ui/match-deck"
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
  const hit = matchFamilies().find((family) => family.id === pack.transfer.family)
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
      <RefreshCw />
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
    hint: "Your own 3:00. Boards count until it hits zero.",
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

export function BattleApp({ library: initialLibrary }: { library: readonly FamilyShelf[] }) {
  const [library, setLibrary] = useState(initialLibrary)
  const [dealt, setDealt] = useState<ReturnType<typeof dealMatch> | null>(null)
  const [marks, setMarks] = useState<FamilyMarks>({ played: [], disliked: [] })
  const [arena, setArena] = useState<"play" | "watch">("play")
  const [leftMix, setLeftMix] = useState<LearnerMixId>("astra")
  const [rightMix, setRightMix] = useState<LearnerMixId>("astra")
  const [length, setLength] = useState<MatchLength>(DEFAULT_MATCH_LENGTH)
  const [practice, setPractice] = useState(false)
  const [session, setSession] = useState(0)
  const [source, setSource] = useState("verified starter")
  const [hash, setHash] = useState<string | undefined>()
  const deal = (nextMarks: FamilyMarks, nextLength = length, shelf = library) => {
    setMarks(nextMarks)
    setDealt(dealMatch(nextLength, nextMarks, shelf))
    setSession((value) => value + 1)
    setSource("verified starter")
    setHash(undefined)
  }
  if (!dealt) {
    return (
      <FamilyGate
        arena={arena}
        leftMix={leftMix}
        rightMix={rightMix}
        length={length}
        marks={marks}
        onArena={setArena}
        onLeftMix={setLeftMix}
        onRightMix={setRightMix}
        onLength={setLength}
        onMarks={setMarks}
        onRefreshLibrary={() => {
          const next = buildFamilyLibrary({ refresh: true })
          setLibrary(next)
        }}
        onPlay={(nextMarks) => deal(nextMarks, length, library)}
      />
    )
  }
  const packs = dealt.packs
  return (
    <BattleSession
      key={`${session}:${dealt.length}:${practice}:${packs.map((pack) => pack.seed).join("-")}`}
      packs={packs}
      arena={arena}
      leftMix={leftMix}
      rightMix={rightMix}
      length={dealt.length}
      gameCount={dealt.gameCount}
      roundsPerGame={dealt.roundsPerGame}
      clock={dealt.clock}
      cap={dealt.timeCapMs ?? 600_000}
      practice={practice}
      source={source}
      hash={hash}
      onPractice={() => setPractice((value) => !value)}
      onSource={setSource}
      onHash={setHash}
      onRematch={() => deal(marks, dealt.length, library)}
      onSetup={() => setDealt(null)}
      onReplaceFirst={(pack) => {
        setDealt((current) =>
          current
            ? { ...current, packs: [pack, ...current.packs.slice(1)] }
            : current
        )
        setSession((value) => value + 1)
      }}
    />
  )
}

const mixCopy: Record<
  (typeof learnerModeIds)[number],
  { label: string; detail: string }
> = {
  astra: {
    label: "Astra",
    detail: "Same public board as you. Astra names one cell or a short burst of taps.",
  },
  code: {
    label: "Code",
    detail: "Astra writes a tiny policy. This browser runs it. No JavaScript is eval'd.",
  },
  "astra-jev": {
    label: "Astra + Jev",
    detail: "Astra writes the plan as context. Jev commits it when a Jev credential is set.",
  },
  "jev-bare": {
    label: "Jev bare",
    detail: "Jev sees the public board only. No Astra plan is wrapped around it.",
  },
  "astra-laya": {
    label: "Astra + Laya",
    detail: "Astra writes the plan as context. Laya commits it when a Laya credential is set.",
  },
  "laya-bare": {
    label: "Laya bare",
    detail: "Laya sees the public board only. No Astra plan is wrapped around it.",
  },
  "openai-decisions": {
    label: "OpenAI Decisions",
    detail: "OpenAI Decisions stays on this machine. Nothing is sent.",
  },
}

function modeNote(
  mix: LearnerMixId,
  servers: { openai: boolean; gateway: boolean; jev: boolean; laya: boolean } | null
) {
  if (!servers) return ""
  if (mix === "openai-decisions") return ""
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
  mix,
  servers,
  onMix,
}: {
  legend: string
  mix: LearnerMixId
  servers: { openai: boolean; gateway: boolean; jev: boolean; laya: boolean } | null
  onMix: (mix: LearnerMixId) => void
}) {
  const note = modeNote(mix, servers)
  const copy = mixCopy[mix as (typeof learnerModeIds)[number]] ?? mixCopy.astra
  return (
    <fieldset className="choice-row">
      <legend>{legend}</legend>
      {learnerModeIds.map((id) => (
        <button
          key={id}
          type="button"
          className="paper-button"
          aria-pressed={mix === id}
          onClick={() => onMix(id)}
        >
          {mixCopy[id].label}
        </button>
      ))}
      <p>
        {copy.detail}
        {note ? ` ${note}` : ""}
      </p>
    </fieldset>
  )
}

function FamilyGate({
  arena,
  leftMix,
  rightMix,
  length,
  marks,
  onArena,
  onLeftMix,
  onRightMix,
  onLength,
  onMarks,
  onRefreshLibrary,
  onPlay,
}: {
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  marks: FamilyMarks
  onArena: (arena: "play" | "watch") => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onLength: (length: MatchLength) => void
  onMarks: (marks: FamilyMarks) => void
  onRefreshLibrary: () => void
  onPlay: (marks: FamilyMarks) => void
}) {
  const families = matchFamilies()
  const [played, setPlayed] = useState<readonly string[]>(marks.played)
  const [disliked, setDisliked] = useState<readonly string[]>(marks.disliked)
  const [servers, setServers] = useState<{
    openai: boolean
    gateway: boolean
    jev: boolean
    laya: boolean
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/learner-mix")
      .then((response) => response.json())
      .then(
        (body: {
          openai?: unknown
          gateway?: unknown
          jev?: unknown
          laya?: unknown
        }) => {
          if (cancelled) return
          setServers({
            openai: body.openai === true,
            gateway: body.gateway === true,
            jev: body.jev === true,
            laya: body.laya === true,
          })
        }
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const toggle = (
    id: string,
    selected: readonly string[],
    setSelected: (next: readonly string[]) => void,
    kind: "played" | "disliked"
  ) => {
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id]
    setSelected(next)
    onMarks(
      kind === "played"
        ? { played: next, disliked }
        : { played, disliked: next }
    )
  }
  const watching = arena === "watch"
  return (
    <main className="battle-ground is-setup">
      <a className="skip-link" href="#start-match">
        Skip to start
      </a>
      <form
        className="family-gate"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay({ played, disliked })
        }}
      >
        <header className="setup-intro">
          <p className="wordmark">astra-vs-human</p>
          <h1>Same rules. Two clocks.</h1>
          <p>
            Pick who plays, then how long the match is. Mark families you
            have played or want less of. New families come first.
          </p>
        </header>
        <fieldset className="variant-grid">
          <legend>1 · Who plays</legend>
          <button
            type="button"
            className="variant-card"
            aria-pressed={arena === "play"}
            onClick={() => onArena("play")}
          >
            <span className="variant-boards" aria-hidden="true">
              <span>
                <User /> You
              </span>
              <span>
                <Bot /> Agent
              </span>
            </span>
            <strong>You vs Agent</strong>
            <span>You tap the left board.</span>
          </button>
          <button
            type="button"
            className="variant-card"
            aria-pressed={arena === "watch"}
            onClick={() => onArena("watch")}
          >
            <span className="variant-boards" aria-hidden="true">
              <span>
                <Bot /> A
              </span>
              <span>
                <Bot /> B
              </span>
            </span>
            <strong>Agent vs Agent</strong>
            <span>You watch both clocks.</span>
          </button>
        </fieldset>
        <fieldset className="length-choices">
          <legend>Match length</legend>
          {MATCH_LENGTHS.map((id) => (
            <div key={id} className="length-choice">
              <button
                type="button"
                className="paper-button length-button"
                aria-pressed={length === id}
                onClick={() => onLength(id)}
              >
                <ModeIcon length={id} />
                {LENGTH_COPY[id].label}
              </button>
              <p>{LENGTH_COPY[id].hint}</p>
            </div>
          ))}
        </fieldset>
        <fieldset className="family-block">
          <legend>2 · Families you already know</legend>
          <ul className="family-list">
            {families.map((family) => (
              <li
                key={family.id}
                className="family-row"
                data-demoted={family.demote || undefined}
              >
                <div className="family-copy">
                  <FamilyIcon family={family} />
                  <div>
                    <strong>
                      {family.label}
                      {family.spirit ? (
                        <em className="family-spirit"> · {family.spirit}</em>
                      ) : null}
                      {family.demote ? (
                        <em className="family-spirit"> · demoted</em>
                      ) : null}
                    </strong>
                    <p>
                      {family.n}×{family.n}. {family.pattern}
                    </p>
                  </div>
                </div>
                <div className="family-marks">
                  <button
                    type="button"
                    className="paper-button"
                    aria-pressed={played.includes(family.id)}
                    aria-label={`Played ${family.label}`}
                    onClick={() =>
                      toggle(family.id, played, setPlayed, "played")
                    }
                  >
                    Played
                  </button>
                  <button
                    type="button"
                    className="paper-button"
                    aria-pressed={disliked.includes(family.id)}
                    aria-label={`Less of ${family.label}`}
                    onClick={() =>
                      toggle(family.id, disliked, setDisliked, "disliked")
                    }
                  >
                    Less
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
        {watching ? (
          <>
            <ModePicker
              legend="3 · Agent A"
              mix={leftMix}
              servers={servers}
              onMix={onLeftMix}
            />
            <ModePicker
              legend="4 · Agent B"
              mix={rightMix}
              servers={servers}
              onMix={onRightMix}
            />
          </>
        ) : (
          <ModePicker
            legend="3 · Agent ability"
            mix={rightMix}
            servers={servers}
            onMix={onRightMix}
          />
        )}
        <div className="setup-actions">
          <button
            type="button"
            className="paper-button"
            onClick={() => onRefreshLibrary()}
          >
            <RefreshCw />
            Respawn pack bank
          </button>
          <button id="start-match" type="submit" className="primary-button">
            Start
          </button>
        </div>
        <p className="setup-footnote">
          Fresh boards assemble locally from the bank. Invent / Sol uses OpenAI
          only when you ask mid-match.
        </p>
      </form>
    </main>
  )
}

function BattleSession({
  packs,
  arena,
  leftMix,
  rightMix,
  length,
  gameCount,
  roundsPerGame,
  clock,
  cap,
  practice,
  source,
  hash,
  onPractice,
  onSource,
  onHash,
  onRematch,
  onSetup,
  onReplaceFirst,
}: {
  packs: readonly GamePack[]
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  gameCount: number
  roundsPerGame: number
  clock: "attempt" | "side"
  cap: number
  practice: boolean
  source: string
  hash?: string
  onPractice: () => void
  onSource: (source: string) => void
  onHash: (hash: string) => void
  onRematch: () => void
  onSetup: () => void
  onReplaceFirst: (pack: GamePack) => void
}) {
  const [battle] = useState(() =>
    createBattleGround(packs, {
      timeCapMs: cap,
      actionCap: 300,
      startPaused: true,
      roundsPerGame,
      clock,
      practice,
    })
  )
  const snapshot = useSyncExternalStore(
    battle.subscribe,
    battle.getSnapshot,
    battle.getSnapshot
  )
  const models = useLearnerModel()
  const { getModel, endRound, startRound } = models
  const [started, setStarted] = useState(false)
  const [rulesShown, setRulesShown] = useState(false)
  const watching = arena === "watch"
  const [lastCell, setLastCell] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
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
  })
  const rightLearner = useSideLearner({
    enabled: true,
    side: "learner",
    battle,
    packs,
    started,
    mix: rightMix,
    getModel,
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
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])
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

  async function generate(transfer: boolean) {
    if (busy || armed) {
      setNotice({ x: 24, y: 24, text: "Finish your attempt first" })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/game-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: crypto.getRandomValues(new Uint32Array(1))[0],
          n: humanPack.n,
          preferences: {
            categories: [humanPack.category],
            visibility: "full",
            targetSeconds: humanPack.session.targetSeconds,
          },
          ...(transfer && hash ? { transferFrom: hash } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      })
      const result = (await response.json()) as Generated & { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? "Generation did not finish. Try again.")
      const next = packSchema.parse(result.pack)
      if (next.category !== humanPack.category)
        throw new Error("The generator returned another game category.")
      if (packs.some((pack, index) => index > 0 && pack.seed === next.seed))
        throw new Error("That seed is already in this match.")
      onSource(
        `${result.meta.source} · ${(result.meta.elapsedMs / 1000).toFixed(1)}s`
      )
      onHash(result.meta.contentHash)
      onReplaceFirst(next)
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
    if (models.status !== "ready" || !startRound(MATCH_ID)) return
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
  const matchOver =
    snapshot.matchComplete ||
    blitzDone ||
    (started &&
      !snapshot.canAdvance.human &&
      !snapshot.canAdvance.learner &&
      humanDone &&
      !learnerPlaying)
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
  const winnerLabel =
    winner === "tie"
      ? "Tie"
      : winner === "human"
        ? leftName
        : rightName
  return (
    <main className="battle-ground" data-match-over={matchOver || undefined}>
      <a className="skip-link" href="#boards">
        Skip to boards
      </a>
      <header className="battle-top">
        <div className="match-progress" aria-label="Human and Agent match progress">
          {(["human", "learner"] as const).map((side) => {
            const cursor = snapshot.cursors[side]
            const label = side === "human" ? leftName : rightName
            return (
              <section key={side} className="match-side" aria-label={`${label} progress`}>
                <header>
                  <strong>{label}</strong>
                  <span
                    className="match-clock"
                    aria-label={
                      length === "blitz"
                        ? `${label} 3 minute clock`
                        : `${label} clock`
                    }
                  >
                    {length === "blitz" ? (
                      <span className="clock-tag">3 min</span>
                    ) : null}
                    <span className="clock-digits">
                      {formatClock(snapshot.remainingMs[side])}
                    </span>
                  </span>
                </header>
                <span className="match-ability">
                  {side === "human" ? leftAbility : rightAbility}
                </span>
                <span className="match-round">
                  {roundText(length, cursor, gameCount, roundsPerGame)}
                </span>
                {length === "blitz" ? null : (
                <ol className="match-games">
                  {Array.from({ length: gameCount }, (_, game) => (
                    <li key={game} className="match-game">
                      <span className="match-game-name">
                        {familyLabel(packs[game * roundsPerGame])}
                      </span>
                      <span className="small-rounds">
                        {Array.from({ length: roundsPerGame }, (_, round) => {
                          const index = game * roundsPerGame + round
                          const done = snapshot.records.some(
                            (record) =>
                              record.side === side &&
                              record.seed === packs[index].seed
                          )
                          const current = cursor.index === index
                          return (
                            <span
                              key={packs[index].seed}
                              className="small-round"
                              data-current={current || undefined}
                              data-done={done || undefined}
                              aria-label={
                                done
                                  ? `${label} game ${game + 1} round ${round + 1}, done`
                                  : current
                                    ? `${label} game ${game + 1} round ${round + 1}, current`
                                    : `${label} game ${game + 1} round ${round + 1}`
                              }
                            >
                              {round + 1}
                            </span>
                          )
                        })}
                      </span>
                    </li>
                  ))}
                </ol>
                )}
              </section>
            )
          })}
        </div>
        <div className="brand-block">
          <div className="wordmark">astra-vs-human</div>
          <p className="match-lede">
            {watching
              ? "Two agents, two clocks. You watch. Next does not move either of them."
              : "You play the left board. The agent plays the right, on its own clock."}
          </p>
        </div>
        <div className="battle-settings">
          {length === "blitz" ? (
            <span className="clock-tag">3 min each</span>
          ) : (
            <span className="clock-tag">10 min if stuck</span>
          )}
          <button
            type="button"
            className="paper-button"
            aria-pressed={practice}
            disabled={armed || busy}
            aria-label={
              practice
                ? "Test mode: scores excluded. Switch to a scored round"
                : "Scored round. Switch to test mode"
            }
            onClick={onPractice}
          >
            {practice ? <LockOpen /> : <Lock />}
            {practice ? "Test" : "Real"}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={armed || busy}
            onClick={onSetup}
          >
            Setup
          </button>
        </div>
        <div className="match-actions">
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
            <Play />
            {!rulesShown
              ? "Show rules"
              : !started
                ? "Start both"
                : watching
                  ? "Watching"
                  : nextLabel}
          </button>
          <p className="match-hint">
            {watching && started
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
                            : "Both sides finished this match."}
          </p>
        </div>
      </header>
      <div className="battle-title">
        <h1>{familyLabel(humanPack)}</h1>
        <span className="mode-badge">{humanPack.mode}</span>
        <span className="battle-size">
          {humanPack.n} × {humanPack.n}
        </span>
      </div>
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
        canUndo={humanAttempt.state.history.length > 0}
        agentStatus={agentStatus}
        claim={claim}
        invalidIndex={showInvalid ? lastCell : null}
        rulesShown={rulesShown}
        humanDone={humanDone}
        agentWorking={!watching && humanDone && learnerPlaying}
        splitBoards={snapshot.seeds.human !== snapshot.seeds.learner}
        onTap={handleTap}
        onUndo={() => battle.actions("human").undo()}
        onClear={() => battle.actions("human").clear()}
      />
      {matchOver ? (
        <section className="match-results" role="dialog" aria-label="Match results">
          <header>
            <p className="wordmark">Match over</p>
            <h2>{winnerLabel}</h2>
            <p>
              {leftName}: {humanTally.rounds} boards · {humanTally.actions} taps
              {length === "blitz"
                ? ` · ${formatClock(snapshot.remainingMs.human)} left`
                : ""}
            </p>
            <p>
              {rightName}: {learnerTally.rounds} boards · {learnerTally.actions}{" "}
              taps
              {length === "blitz"
                ? ` · ${formatClock(snapshot.remainingMs.learner)} left`
                : ""}
            </p>
            {blitzResult ? <p className="results-blitz">{blitzResult}</p> : null}
          </header>
          <div className="results-actions">
            <button type="button" className="primary-button" onClick={onRematch}>
              <RefreshCw />
              Rematch
            </button>
            <button type="button" className="paper-button" onClick={onSetup}>
              Back to setup
            </button>
            <button
              type="button"
              className="paper-button"
              disabled={busy}
              onClick={() => void generate(true)}
            >
              {busy ? "Generating…" : "Sol respawn family"}
            </button>
          </div>
        </section>
      ) : null}
      <footer className="battle-footer">
        <span className="seed">
          HUMAN SEED {humanPack.seed}
          {snapshot.seeds.human !== snapshot.seeds.learner
            ? ` · AGENT SEED ${learnerPack.seed}`
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
        {error ? (
          <p role="alert" className="battle-error">
            {error}
          </p>
        ) : null}
      </footer>
      {notice ? (
        <div role="status" className="cursor-notice" style={{ left: notice.x + 12, top: notice.y + 12 }}>
          {notice.text}
        </div>
      ) : null}
    </main>
  )
}
