"use client"

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"

import { familyPaint } from "@/lib/battle-ground-ui/family-bias"
import { familyLabel } from "@/lib/battle-ground-ui/labels"
import type { GamePack } from "@/lib/mini-game-rules/schema"

const readLength = (style: CSSStyleDeclaration, name: string) => {
  const value = Number.parseFloat(style.getPropertyValue(name))
  return Number.isFinite(value) ? value : 0
}

/**
 * One square per board, painted in that family's color.
 * Two-color families split the square on the diagonal.
 * Blitz pins the active frame and slides the ribbon left on each advance,
 * repeating the cycle until the row overflows.
 */
export const RoundStrip = ({
  label,
  packs,
  index,
  done,
  windowed = false,
}: {
  label: string
  packs: readonly GamePack[]
  index: number
  done: ReadonlySet<number>
  windowed?: boolean
}) => {
  const viewRef = useRef<HTMLDivElement>(null)
  const [extra, setExtra] = useState(0)
  const safeIndex =
    packs.length === 0 ? 0 : Math.min(Math.max(index, 0), packs.length - 1)

  useLayoutEffect(() => {
    if (!windowed) return
    const view = viewRef.current
    if (!view) return
    const fit = () => {
      const style = getComputedStyle(view)
      const step = readLength(style, "--round") + readLength(style, "--round-gap")
      if (step <= 0) return
      const room = Math.ceil(view.clientWidth / step) + 1
      const need = Math.max(packs.length, safeIndex + room)
      setExtra(Math.max(0, need - packs.length))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(view)
    return () => observer.disconnect()
  }, [windowed, packs.length, safeIndex])

  if (packs.length === 0) return null

  const count = packs.length + (windowed ? extra : 0)
  const style = { "--round-index": safeIndex } as CSSProperties

  return (
    <div className="small-rounds" data-window={windowed || undefined} style={style}>
      <div className="small-rounds-view" ref={viewRef}>
        <ol aria-label={label}>
          {Array.from({ length: count }, (_, slot) => {
            const pack = packs[slot % packs.length]
            if (!pack) return null
            const paint = familyPaint(pack.transfer.family, pack.category)
            const real = slot < packs.length
            const current = real && slot === safeIndex
            const finished = real && done.has(slot)
            const name = familyLabel(pack)
            return (
              <li
                key={real ? pack.seed : `again-${slot}`}
                className="small-round"
                data-split={paint[1] ? true : undefined}
                data-current={current || undefined}
                data-done={finished || undefined}
                data-upcoming={(!current && !finished) || undefined}
                aria-hidden={real ? undefined : true}
                aria-current={current ? "step" : undefined}
                aria-label={
                  real
                    ? `${name}${finished ? ", done" : ""}${current ? ", now" : ""}`
                    : undefined
                }
                title={name}
                style={
                  {
                    "--round-a": paint[0],
                    "--round-b": paint[1] ?? paint[0],
                  } as CSSProperties
                }
              />
            )
          })}
        </ol>
        {windowed ? (
          <span className="small-rounds-frame" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  )
}
