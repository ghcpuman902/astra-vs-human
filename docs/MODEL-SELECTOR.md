# Model selector (UX stub)

A small control for which OpenAI model plays the Learner on the current round. Cursor can place it on the Agent header. This note adds no renderer and leaves craft tokens as they are.

## Player steps

1. The round already has one pack and one seed.
2. On the Agent side, choose a model id. The default is `gpt-6-astra`.
3. Start the Learner attempt. The human attempt keeps that pack, seed, clock, and action list.

The control names the Learner’s model for this round. The seed stays put. The human board stays the human’s.

## Wire

`POST /api/learner` and `POST /api/game-learner` currently read server env `OPENAI_MODEL`, default `gpt-6-astra`. A thin follow-up can accept an allowlisted `model` string on that same JSON body.

The browser sends the model id. `OPENAI_API_KEY` stays on the server. Unknown or unauthorized ids return the existing reason `unavailable`. The route keeps the requested id and surfaces that failure; it does not substitute another model.

## Fairness

Same pack, same seed, independent attempts. A change of model applies to the Learner attempt. Human taps stay on the human attempt. Inference time continues to count on the Learner clock. Hint stays off in a scored round.

Suggested allowlist for the hack credits: `gpt-6-astra`, plus any other model id the check-in credits actually enable. Extend the list in server code when that set is known. Keep the list short enough to render as a native `<select>`.
