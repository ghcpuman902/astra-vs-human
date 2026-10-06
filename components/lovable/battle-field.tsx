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
        aria-label="Human game"
      >
        <header className="arena-header">
          <strong>HUMAN</strong>
          <span>
            {clock(humanElapsedMs)} · {humanActions} actions ·{" "}
            {started ? humanStatus : "ready"}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              board={humanBoard}
              interactive
              invalidIndex={invalidIndex}
              label={`Human ${pack.n} by ${pack.n} board`}
              onTap={onTap}
            />
          ) : (
            <div className="puzzle-cover">
              <span>Read the shared rules, then start both clocks.</span>
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
            {started ? `${clock(remainingMs)} left` : "Rules are shared"}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={loading || (started && !finished)}
            onClick={() => {
              if (!started) onStart()
            }}
          >
            <Play />
            {!started
              ? "Start both"
              : finished
                ? "Both finished"
                : clock(remainingMs)}
          </button>
          <span className="stage-progress">
            {practice
              ? "Practice · excluded from scores"
              : `Typical ${pack.session.targetSeconds}s · LEARNER`}
          </span>
        </div>
        <div className="postcard-rules">
          <p className="postcard-goal">{card.goal}</p>
          <ul>
            {card.rules.map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
          </ul>
        </div>
        <p className="learner-note" aria-live="polite">
          {learnerStatus === "playing"
            ? agentStatus
            : started
              ? learnerStatus
              : "Learner waits for Start."}
          {finished && claim ? <blockquote>{claim}</blockquote> : null}
        </p>
      </aside>
      <section
        className="battle-arena"
        data-player="learner"
        aria-label="Agent game"
      >
        <header className="arena-header">
          <strong>AGENT</strong>
          <span>
            {clock(learnerElapsedMs)} · {learnerActions} actions · LEARNER
            {started ? ` · ${learnerStatus}` : " · ready"}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              board={learnerBoard}
              interactive={false}
              invalidIndex={null}
              label={`Agent ${pack.n} by ${pack.n} board`}
              onTap={() => {}}
            />
          ) : (
            <div className="puzzle-cover">
              <span>Waiting for Start.</span>
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
