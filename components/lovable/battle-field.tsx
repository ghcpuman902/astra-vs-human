import { useState, type CSSProperties, type ReactNode } from "react"
import { Eye, Pause } from "lucide-react"

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

const STATUS: Record<string, string> = {
  playing: "playing",
  finished: "solved",
  "action-cap": "out of taps",
  "time-cap": "out of time",
}
export const statusWord = (status: string) => STATUS[status] ?? status

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
  agentStatus: string
  claim: string
  invalidIndex: number | null
  rulesShown: boolean
  /** Restored after a reload; boards stay covered until Resume. */
  paused?: boolean
  humanDone: boolean
  agentWorking: boolean
  splitBoards: boolean
  /** Undo · Clear · primary action. Sits under the human board, fixed on phones. */
  dock: ReactNode
  onTap: (cell: number) => void
  onPathStep: (cell: number, cycles: number) => void
}

function Cover({
  board,
  text,
  label,
  locked = false,
}: {
  board: BoardProps
  text: string
  label: string
  /** No peeking while a restored match is paused: the clock is not running. */
  locked?: boolean
}) {
  const [peek, setPeek] = useState(false)
  return (
    <button
      type="button"
      className="puzzle-cover"
      style={coverStyle(board)}
      data-peek={peek || undefined}
      aria-pressed={locked ? undefined : peek}
      disabled={locked}
      onClick={() => setPeek((value) => !value)}
    >
      {peek ? (
        <PaperBoard
          key={`peek-${board.seed}`}
          board={board}
          interactive={false}
          invalidIndex={null}
          label={label}
          onTap={() => {}}
        />
      ) : (
        <span className="cover-copy">
          {locked ? <Pause aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {text}
        </span>
      )}
    </button>
  )
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
  agentStatus,
  claim,
  invalidIndex,
  rulesShown,
  paused = false,
  humanDone,
  agentWorking,
  splitBoards,
  dock,
  onTap,
  onPathStep,
}: BattleFieldProps) => {
  const card = postcards[pack.category]
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
            {humanDone && humanStatus === "finished" ? (
              <em className="done-mark">Solved</em>
            ) : null}
          </strong>
          <span>
            {humanActions} taps
            {started ? ` · ${statusWord(humanStatus)}` : ""}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              key={humanBoard.seed}
              board={humanBoard}
              interactive={humanInteractive}
              invalidIndex={invalidIndex}
              label={`${humanTitle} ${pack.n} by ${pack.n} board`}
              onTap={onTap}
              onPathStep={humanInteractive ? onPathStep : undefined}
            />
          ) : (
            <Cover
              board={humanBoard}
              label={`Peek at ${humanTitle} board`}
              locked={paused}
              text={
                paused
                  ? "Paused. Resume to continue."
                  : humanInteractive
                    ? "Your board. Tap to peek."
                    : "Agent A board. Tap to peek."
              }
            />
          )}
        </div>
      </section>
      {dock}
      <aside className="shared-rules" aria-label="Rules for both boards">
        {rulesShown ? (
          <div className="postcard-rules">
            {splitBoards || practice ? (
              <p className="rules-pending">
                {splitBoards ? "These clues are your current round. " : ""}
                {practice ? "Practice. Not scored." : ""}
              </p>
            ) : null}
            <p className="postcard-goal">{card.goal}</p>
            <ul>
              {card.rules.map((rule, index) => (
                <li key={index}>{rule}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rules-pending">
            The same rules for both boards appear here.
          </p>
        )}
        <div className="learner-note" aria-live="polite">
          {agentWorking ? `${learnerTitle} is still on its own round. ` : null}
          {paused
            ? `${learnerTitle} is paused with you.`
            : !started
              ? `${learnerTitle} waits for Start.`
              : learnerStatus === "playing"
                ? agentStatus
                : `${learnerTitle} ${statusWord(learnerStatus)}.`}
          {finished && claim ? <blockquote>{claim}</blockquote> : null}
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
            {agentWorking ? (
              <em className="behind-mark">Still solving</em>
            ) : null}
          </strong>
          <span>
            {learnerActions} taps
            {started ? ` · ${statusWord(learnerStatus)}` : " · read only"}
          </span>
        </header>
        <div className="arena-stage">
          {started ? (
            <PaperBoard
              key={learnerBoard.seed}
              board={learnerBoard}
              interactive={false}
              invalidIndex={null}
              label={`${learnerTitle} ${learnerBoard.n} by ${learnerBoard.n} board`}
              onTap={() => {}}
            />
          ) : (
            <Cover
              board={learnerBoard}
              label={`Peek at ${learnerTitle} board`}
              locked={paused}
              text={
                paused
                  ? "Paused. Resume to continue."
                  : `${learnerTitle} board. Tap to peek.`
              }
            />
          )}
        </div>
      </section>
    </div>
  )
}
