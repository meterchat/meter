# @getmeter/sdk

Official SDK for the [Meter](https://getmeter.dev) AI API — metered AI with postpaid billing.

## Install

```bash
npm install @getmeter/sdk
```

## Usage

```typescript
import { MeterClient } from "@getmeter/sdk";

const meter = new MeterClient({ apiKey: "mk_your_api_key" });

const stream = await meter.chat({
  messages: [{ role: "user", content: "What is quantum computing?" }],
  model: "anthropic/claude-sonnet-4.6",
  endUserId: "user_123", // your app's user ID
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
| `baseUrl` | `string` | API base URL. Default: `https://getmeter.dev` |

### `meter.chat(options)`

Returns `AsyncIterable<MeterEvent>`.

| Option | Type | Description |
|--------|------|-------------|
| `messages` | `ChatMessage[]` | Chat messages (`role` + `content`) |
| `model` | `string` | Model ID (e.g. `anthropic/claude-sonnet-4.6`). Default: `anthropic/claude-opus-4.6` |
| `endUserId` | `string` | End-user ID from your auth system (for multi-tenant billing) |
| `sessionId` | `string` | Session ID to continue a conversation |

### `meter.listSessions(endUserId)`

List chat sessions for an end-user.

### `meter.createSession(endUserId, name?)`

Create a new chat session.

### `meter.getHistory(endUserId, sessionId)`

Get message history for a session.

### `meter.getBillingStatus(endUserId)`

Check if an end-user has a card on file.

### `meter.createSetupIntent(endUserId)`

Create a Stripe SetupIntent for end-user card collection.

### Events

| Event | Fields | Description |
|-------|--------|-------------|
| `delta` | `content`, `tokensOut` | Streamed text chunk |
| `usage` | `tokensIn`, `tokensOut` | Final token counts |
| `done` | — | Stream complete |
| `error` | `message` | Error occurred |

## License

MIT
