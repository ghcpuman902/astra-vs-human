import { matchFamilies } from "./family-bias"
import type { DealtMatch } from "./match-deck"
import type { GamePack } from "../mini-game-rules/schema"

const FALLBACK_NAMES: Record<GamePack["category"], string> = {
  binary_fill: "Summer Moons",
  crown: "Crown seats",
  path_cover: "Number trail",
  tile_rotate_connect: "Pipe turn",
  lights_toggle: "Cross lights",
  lamp_rays: "Lamplight",
}

export const familyLabel = (pack: GamePack) => {
  const hit = matchFamilies().find((family) => family.id === pack.transfer.family)
  return hit?.label ?? FALLBACK_NAMES[pack.category]
}

export const dealTitle = (dealt: DealtMatch) => {
  if (dealt.length === "deep") return familyLabel(dealt.packs[0])
  if (dealt.length === "tour") return `${dealt.packs.length} families`
  return `${dealt.packs.length} boards, 3 min`
}

export const formatClock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
