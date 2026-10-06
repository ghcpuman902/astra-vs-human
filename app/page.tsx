import type { Metadata } from "next"

import { BattleApp } from "@/components/battle-app"
import showcase from "@/handoffs/mini-game-rules/generated-showcase.json"
import { packSchema } from "@/lib/mini-game-rules/schema"

export const metadata: Metadata = {
  title: "astra-vs-human · Same board, same taps",
  description:
    "Human and Learner carry local puzzle patterns across fresh boards.",
}

export default function Page() {
  const fixtures = showcase.games.map((game) => packSchema.parse(game.pack))
  return <BattleApp fixtures={fixtures} />
}
