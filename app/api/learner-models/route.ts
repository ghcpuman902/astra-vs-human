import { learnerModelConfig } from "@/lib/learner-models"

export function GET() {
  return Response.json(learnerModelConfig(), {
    headers: { "cache-control": "no-store" },
  })
}
