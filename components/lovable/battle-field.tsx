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

/** A mini phone screen. Header, board, then whatever the side needs underneath. */
export function Phone({
  side,
  name,
  sub,
  clock,
  tally,
  rounds,
  done = false,
  behind = false,
  children,
  footer,
}: {
  side: "human" | "learner"
  name: string
  sub: string
  clock: string
  tally: string
  rounds?: ReactNode
  done?: boolean
  behind?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section
      className="phone"
      data-side={side}
      data-done={done || undefined}
      data-behind={behind || undefined}
      aria-label={`${name} game`}
    >
      <header className="phone-bar">
        <div className="phone-name">
          <strong>{name}</strong>
          <span>{sub}</span>
        </div>
        <div className="phone-clock">
          <strong>{clock}</strong>
          <span>{tally}</span>
        </div>
      </header>
      {rounds}
      <div className="arena-stage">{children}</div>
      {footer ? <footer className="phone-foot">{footer}</footer> : null}
    </section>
  )
}

export function BoardStage({
  board,
  started,
  interactive,
  invalidIndex,
  name,
  coverText,
  locked,
  onTap,
  onPathStep,
}: {
  board: BoardProps
  started: boolean
  interactive: boolean
  invalidIndex: number | null
  name: string
  coverText: string
  locked: boolean
  onTap: (cell: number) => void
  onPathStep?: (cell: number, cycles: number) => void
}) {
  return started ? (
    <PaperBoard
      key={board.seed}
      board={board}
      interactive={interactive}
      invalidIndex={invalidIndex}
      label={`${name} ${board.n} by ${board.n} board`}
      onTap={onTap}
      onPathStep={interactive ? onPathStep : undefined}
    />
  ) : (
    <Cover
      board={board}
      label={`Peek at ${name} board`}
      locked={locked}
      text={locked ? "Paused. Resume to continue." : coverText}
    />
  )
}

/** The shared rules, shown once under the left board. */
export function Rules({ pack }: { pack: GamePack }) {
  const card = postcards[pack.category]
  return (
    <div className="postcard-rules">
      <p className="postcard-goal">{card.goal}</p>
      <ul>
        {card.rules.map((rule, index) => (
          <li key={index}>{rule}</li>
        ))}
      </ul>
    </div>
  )
}
