/** Server configuration only. Client code imports this module's types only. */
export type LearnerModelConfig = {
  models: { id: string; label: string }[]
  defaultModel: string
}
const verified = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(id)
export function learnerModelConfig(
  env: { OPENAI_MODEL?: string; LEARNER_MODELS?: string } = {
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    LEARNER_MODELS: process.env.LEARNER_MODELS,
  }
): LearnerModelConfig {
  const preferred =
    env.OPENAI_MODEL && validId(env.OPENAI_MODEL)
      ? env.OPENAI_MODEL
      : "gpt-6-astra"
  const ids =
    env.LEARNER_MODELS === undefined
      ? [...new Set([preferred, ...verified])]
      : [
          ...new Set(
            env.LEARNER_MODELS.split(",")
              .map((id) => id.trim())
              .filter(validId)
          ),
        ].slice(0, 16)
  const allowed = ids.length ? ids : [preferred]
  const labels: Record<string, string> = {
    "gpt-6-astra": "GPT-6 Astra",
    "gpt-6.1-sol": "GPT-6.1 Sol",
    "gpt-6-luna": "GPT-6 Luna",
    "gpt-6-terra": "GPT-6 Terra",
  }
  return {
    models: allowed.map((id) => ({ id, label: labels[id] ?? id })),
    defaultModel: allowed.includes(preferred) ? preferred : allowed[0],
  }
}
export function allowedLearnerModel(
  model?: string,
  config = learnerModelConfig()
): string | null {
  const selected = model ?? config.defaultModel
  return config.models.some((entry) => entry.id === selected) ? selected : null
}
