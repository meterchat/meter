# Meter Fusion

Meter Fusion is the former Factor compound-model product, moved into Meter.

It is not the new Factor. Factor is now the autonomous teleoperator for
androids. Meter Fusion is the model-composition product that belongs inside
Meter's broader pay-per-thought routing and decision infrastructure.

## Product Definition

Meter Fusion lets a builder create a named compound model endpoint without
training a model.

The user picks models, adds examples, defines output shape and rules, tests the
behavior, and deploys one endpoint.

```txt
meter/support-v1
meter/code-reviewer-v2
meter/sales-agent-v4
```

To the application, a Meter Fusion model behaves like a normal model:

```ts
const response = await client.chat.completions.create({
  model: "meter/support-v1",
  messages: [{ role: "user", content: "Refund this order?" }]
});
```

Behind the scenes, Meter Fusion can call Claude, GPT, Gemini, Grok, Llama, Qwen,
specialized open-weight models, search, tools, checks, and fallbacks. The app
gets one output from one endpoint.

## Why It Belongs In Meter

Meter already owns:

- model routing
- usage metering
- provider fallback
- structured multi-model reasoning
- decision logs
- cost and latency tracking
- API keys and developer surfaces

Fusion is a natural Meter surface. It packages Meter's routing intelligence into
a deployable model artifact.

## Core Promise

```txt
Create your own AI model without training one.
```

More precise:

```txt
Turn frontier models, open-weight models, prompts, tools, examples, and rules
into one production endpoint.
```

## Product Mechanic

The mechanic is compound fusion:

```txt
models + prompts + examples + tools + rules + evals -> named endpoint
```

Closed frontier models are composed at runtime. They are not weight-merged.

Open-weight models can later support adapters, merging, distillation, or
fine-tuning, but that is not the MVP.

## MVP Loop

```txt
create recipe
  -> add examples
  -> test against baseline
  -> deploy endpoint
  -> call endpoint
  -> inspect trace
  -> improve recipe
```

## Non-Goals

- Do not move this back into Factor.
- Do not make Fusion the default Meter homepage thesis.
- Do not claim closed model weight merging.
- Do not expose multiple model outputs as the default production API.
- Do not turn it into a broad workflow builder.

## Status

Parked as a Meter product line. Build only after the current Meter core loop
supports the added surface area.
