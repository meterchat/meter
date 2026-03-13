# @meterxyz/sdk

Official SDK for the [Meter](https://getmeter.xyz) AI API — metered, pay-per-use AI.

## Install

```bash
npm install @meterxyz/sdk
```

## Usage

```typescript
import { MeterClient } from "@meterxyz/sdk";

const meter = new MeterClient({ apiKey: "mk_your_api_key" });

const stream = await meter.chat({
  messages: [{ role: "user", content: "What is quantum computing?" }],
  model: "anthropic/claude-opus-4.6",
});

for await (const event of stream) {
  if (event.type === "delta") {
    process.stdout.write(event.content);
  }
  if (event.type === "usage") {
    console.log(`\nTokens: ${event.tokensIn} in, ${event.tokensOut} out`);
  }
}
```

## API

### `new MeterClient(config)`

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | `string` | Your Meter API key (starts with `mk_`) |
| `baseUrl` | `string` | API base URL. Default: `https://getmeter.xyz` |

### `meter.chat(options)`

Returns `AsyncIterable<MeterEvent>`.

| Option | Type | Description |
|--------|------|-------------|
| `messages` | `ChatMessage[]` | Chat messages (`role` + `content`) |
| `model` | `string` | OpenRouter model ID. Default: `anthropic/claude-opus-4.6` |

### Events

| Event | Fields | Description |
|-------|--------|-------------|
| `delta` | `content`, `tokensOut` | Streamed text chunk |
| `usage` | `tokensIn`, `tokensOut` | Final token counts |
| `done` | — | Stream complete |

## License

MIT
