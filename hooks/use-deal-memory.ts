"use client"

import { useSyncExternalStore } from "react"

import { boardId, type DealtMatch } from "@/lib/battle-ground-ui/match-deck"

/** What this browser was dealt lately. Ranking ties and board picks avoid it. */
export type DealMemory = {
  recent: readonly string[]
  boards: readonly string[]
}

const KEY = "avh:deal-memory:v1"
const RECENT = 12
const BOARDS = 400
const empty: DealMemory = { recent: [], boards: [] }
const listeners = new Set<() => void>()
let cache: DealMemory | null = null

const strings = (value: unknown, limit: number) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(-limit)
    : []

function read(): DealMemory {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null")
    const record = parsed && typeof parsed === "object" ? parsed : {}
    cache = {
      recent: strings((record as DealMemory).recent, RECENT),
      boards: strings((record as DealMemory).boards, BOARDS),
    }
  } catch {
    cache = empty
  }
  return cache
}

export function rememberDeal(dealt: DealtMatch) {
  const memory = read()
  const families = [...new Set(dealt.packs.map((pack) => pack.transfer.family))]
  cache = {
    recent: [
      ...memory.recent.filter((id) => !families.includes(id)),
      ...families,
    ].slice(-RECENT),
    boards: [...memory.boards, ...dealt.packs.map(boardId)].slice(-BOARDS),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {}
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDealMemory(): DealMemory {
  return useSyncExternalStore(subscribe, read, () => empty)
}

const noop = () => () => {}
/** False during SSR and hydration, true after. Deals are client-only. */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  )
}
