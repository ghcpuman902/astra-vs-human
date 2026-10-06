import { learnerCredentials } from "@/lib/battle-ground-ui/learner-mix"

export const runtime = "nodejs"

/** Reports which learner credentials are present. Never returns secret values. */
export function GET() {
  const credentials = learnerCredentials()
  return Response.json(
    {
      openai: credentials.openAI,
      gateway: credentials.gateway,
      jev: credentials.jev,
    },
    { headers: { "cache-control": "no-store" } }
  )
}
