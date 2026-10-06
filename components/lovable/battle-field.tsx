import { Play, RotateCcw, Undo2 } from "lucide-react"

import { postcards } from "@/components/lovable/marks"
import { PaperBoard } from "@/components/lovable/paper-board"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import type { GamePack } from "@/lib/mini-game-rules/schema"

type BattleFieldProps = {
  pack: GamePack
  practice: boolean
  loading: boolean
  started: boolean
  finished: boolean
  remainingMs: number
  humanBoard: BoardProps
  learnerBoard: BoardProps
  humanActions: number
  learnerActions: number
  humanStatus: string
  learnerStatus: string
  humanElapsedMs: number
  learnerElapsedMs: number
  canUndo: boolean
  agentStatus: string
  claim: string
  invalidIndex: number | null
  rulesShown: boolean
  humanDone: boolean
  agentWorking: boolean
  humanRound: string
  learnerRound: string
  splitBoards: boolean
  canAdvanceHuman: boolean
  nextLabel: string
  onReveal: () => void
  onNext: () => void
  onStart: () => void
  onTap: (cell: number) => void
  onUndo: () => void
  onClear: () => void
}

const clock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export const BattleField = ({
  pack,
  practice,
  loading,
  started,
  finished,
  remainingMs,
  humanBoard,
  learnerBoard,
  humanActions,
  learnerActions,
  humanStatus,
  learnerStatus,
  humanElapsedMs,
  learnerElapsedMs,
  canUndo,
  agentStatus,
  claim,
  invalidIndex,
  rulesShown,
  humanDone,
  agentWorking,
  humanRound,
  learnerRound,
  splitBoards,
  canAdvanceHuman,
  nextLabel,
  onReveal,
  onNext,
  onStart,
  onTap,
  onUndo,
  onClear,
}: BattleFieldProps) => {
  const card = postcards[pack.category]
  const playing = started && humanBoard.status === "playing"
  return (
    <div className="battle-field">
      <section
        className="battle-arena"
        data-player="human"
        data-done={humanDone || undefined}
        aria-label="Human game"
      >
        <header className="arena-header">
          <strong>
            HUMAN
            {humanDone ? <em className="done-mark">Done</em> : null}
          </strong>
          <span>
            {humanRound} · {clock(humanElapsedMs)} · {humanActions} actions ·{" "}
            {started ? humanStatus : "ready"}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              key={humanBoard.seed}
              board={humanBoard}
              interactive
              invalidIndex={invalidIndex}
              label={`Human ${pack.n} by ${pack.n} board`}
              onTap={onTap}
            />
          ) : (
            <div className="puzzle-cover">
              <span>
                {rulesShown
                  ? "Ready when you are."
                  : "Rules stay hidden until you reveal them."}
              </span>
            </div>
          )}
        </div>
        <footer className="arena-footer">
          <div className="battle-controls">
            <button
              type="button"
              className="paper-button"
              disabled={!playing || !canUndo}
              onClick={onUndo}
            >
              <Undo2 />
              Undo
            </button>
            <button
              type="button"
              className="paper-button"
              disabled
              title="Hints unavailable in scored play"
            >
              Hint
            </button>
            <button
              type="button"
              className="paper-button"
              disabled={!playing}
              onClick={onClear}
            >
              <RotateCcw />
              Clear
            </button>
          </div>
        </footer>
      </section>
      <aside className="shared-rules">
        <div className="stage-control">
          <span className="stage-reading">
            {started
              ? `${clock(remainingMs)} left`
              : rulesShown
                ? "Rules are shared"
                : "Same reveal for both"}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={
              loading ||
              (started && !humanDone) ||
              (started && humanDone && !canAdvanceHuman)
            }
            onClick={() => {
              if (!rulesShown) onReveal()
              else if (!started) onStart()
              else if (humanDone && canAdvanceHuman) onNext()
            }}
          >
            <Play />
            {!rulesShown
              ? "Show rules"
              : !started
                ? "Start both"
                : humanDone
                  ? nextLabel
                  : clock(remainingMs)}
          </button>
          <span className="stage-progress">
            {agentWorking
              ? "Agent is still on its own round. You can move on."
              : practice
                ? "Practice · excluded from scores"
                : humanDone
                  ? "This puzzle is done."
                  : `Typical ${pack.session.targetSeconds}s · LEARNER`}
          </span>
        </div>
        {rulesShown ? (
          <div className="postcard-rules">
            {splitBoards ? (
              <p className="rules-pending">These clues are the human&apos;s current round.</p>
            ) : null}
            <p className="postcard-goal">{card.goal}</p>
            <ul>
              {card.rules.map((rule, index) => (
                <li key={index}>{rule}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rules-pending">Rules appear for both players at once.</p>
        )}
        <p className="learner-note" aria-live="polite">
          {splitBoards ? `${learnerRound}. ` : null}
          {learnerStatus === "playing"
            ? agentStatus
            : started
              ? learnerStatus
              : rulesShown
                ? "Learner waits for Start."
                : "Learner has not seen the rules."}
          {finished && claim ? <blockquote>{claim}</blockquote> : null}
        </p>
      </aside>
      <section
        className="battle-arena"
        data-player="learner"
        data-behind={agentWorking || undefined}
        aria-label="Agent game"
      >
        <header className="arena-header">
          <strong>
            AGENT
            {agentWorking ? <em className="behind-mark">Still here</em> : null}
          </strong>
          <span>
            {learnerRound} · {clock(learnerElapsedMs)} · {learnerActions}{" "}
            actions · LEARNER
            {started ? ` · ${learnerStatus}` : " · ready"}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              key={learnerBoard.seed}
              board={learnerBoard}
              interactive={false}
              invalidIndex={null}
              label={`Agent ${learnerBoard.n} by ${learnerBoard.n} board`}
              onTap={() => {}}
            />
          ) : (
            <div className="puzzle-cover">
              <span>
                {rulesShown ? "Waiting for Start." : "Waiting for the rules."}
              </span>
            </div>
          )}
        </div>
        <footer className="arena-footer">
          <span className="agent-idle">LEARNER · L0</span>
          <span>{started ? agentStatus : "Idle until both clocks start"}</span>
        </footer>
      </section>
    </div>
  )
}
