import { useState, type CSSProperties } from "react"
import { RotateCcw, Undo2 } from "lucide-react"

import { postcards } from "@/components/lovable/marks"
import { PaperBoard } from "@/components/lovable/paper-board"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import type { GamePack } from "@/lib/mini-game-rules/schema"

const coverStyle = (board: BoardProps): CSSProperties => {
  const quotas =
    "constraints" in board.clues &&
    board.clues.constraints.some((rule) => rule.kind === "quota")
  return {
    "--n": board.n,
    "--cover-extra": quotas ? "24px" : "0px",
  } as CSSProperties
}

type BattleFieldProps = {
  pack: GamePack
  practice: boolean
  humanTitle?: string
  learnerTitle?: string
  humanInteractive?: boolean
  started: boolean
  finished: boolean
  humanBoard: BoardProps
  learnerBoard: BoardProps
  humanActions: number
  learnerActions: number
  humanStatus: string
  learnerStatus: string
  canUndo: boolean
  agentStatus: string
  claim: string
  invalidIndex: number | null
  rulesShown: boolean
  humanDone: boolean
  agentWorking: boolean
  splitBoards: boolean
  onTap: (cell: number) => void
  onUndo: () => void
  onClear: () => void
}

export const BattleField = ({
  pack,
  practice,
  humanTitle = "Human",
  learnerTitle = "Agent",
  humanInteractive = true,
  started,
  finished,
  humanBoard,
  learnerBoard,
  humanActions,
  learnerActions,
  humanStatus,
  learnerStatus,
  canUndo,
  agentStatus,
  claim,
  invalidIndex,
  rulesShown,
  humanDone,
  agentWorking,
  splitBoards,
  onTap,
  onUndo,
  onClear,
}: BattleFieldProps) => {
  const card = postcards[pack.category]
  const playing = started && humanInteractive && humanBoard.status === "playing"
  const [peekHuman, setPeekHuman] = useState(false)
  const [peekAgent, setPeekAgent] = useState(false)
  return (
    <div className="battle-field" id="boards">
      <section
        className="battle-arena"
        data-player="human"
        data-done={humanDone || undefined}
        aria-label={`${humanTitle} game`}
      >
        <header className="arena-header">
          <strong>
            {humanTitle}
            {humanDone ? <em className="done-mark">Done</em> : null}
          </strong>
          <span>
            {humanActions} taps · {started ? humanStatus : "ready"}
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
            <button
              type="button"
              className="puzzle-cover"
              style={coverStyle(humanBoard)}
              data-peek={peekHuman || undefined}
              aria-pressed={peekHuman}
              onClick={() => setPeekHuman((value) => !value)}
            >
              {peekHuman ? (
                <PaperBoard
                  key={`peek-h-${humanBoard.seed}`}
                  board={humanBoard}
                  interactive={false}
                  invalidIndex={null}
                  label="Peek at human board"
                  onTap={() => {}}
                />
              ) : (
                <span>
                  {humanInteractive
                    ? "Your board. Tap to peek, then share rules."
                    : "Agent A. Tap to peek at the empty craft."}
                </span>
              )}
            </button>
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
        {rulesShown ? (
          <div className="postcard-rules">
            {splitBoards ? (
              <p className="rules-pending">These clues are your current round.</p>
            ) : null}
            {practice ? (
              <p className="rules-pending">Practice. Not scored.</p>
            ) : null}
            <p className="postcard-goal">{card.goal}</p>
            <ul>
              {card.rules.map((rule, index) => (
                <li key={index}>{rule}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rules-pending">Shared clues appear here for both players.</p>
        )}
        <div className="learner-note" aria-live="polite">
          {agentWorking ? "Agent still on its own round. " : null}
          {learnerStatus === "playing"
            ? agentStatus
            : started
              ? learnerStatus
              : "Agent waits for Start."}
          {finished && claim ? <blockquote>{claim}</blockquote> : null}
        </div>
        <div className="mobile-agent-dock" aria-live="polite">
          <strong>{learnerTitle}</strong>
          <span>
            {agentWorking
              ? "Still solving — scroll rules below."
              : started
                ? learnerStatus
                : "Waiting"}
          </span>
        </div>
      </aside>
      <section
        className="battle-arena"
        data-player="learner"
        data-behind={agentWorking || undefined}
        aria-label={`${learnerTitle} game`}
      >
        <header className="arena-header">
          <strong>
            {learnerTitle}
            {agentWorking ? <em className="behind-mark">Still here</em> : null}
          </strong>
          <span>
            {learnerActions} taps · {started ? learnerStatus : "ready"}
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
            <button
              type="button"
              className="puzzle-cover"
              style={coverStyle(learnerBoard)}
              data-peek={peekAgent || undefined}
              aria-pressed={peekAgent}
              onClick={() => setPeekAgent((value) => !value)}
            >
              {peekAgent ? (
                <PaperBoard
                  key={`peek-a-${learnerBoard.seed}`}
                  board={learnerBoard}
                  interactive={false}
                  invalidIndex={null}
                  label="Peek at agent board"
                  onTap={() => {}}
                />
              ) : (
                <span>Agent board. Tap to peek empty craft.</span>
              )}
            </button>
          )}
        </div>
        <footer className="arena-footer">
          <span className="agent-idle">Read only</span>
          <span>{started ? agentStatus : "Starts with you"}</span>
        </footer>
      </section>
    </div>
  )
}
