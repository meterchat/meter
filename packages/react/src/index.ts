// Components
export { MeterProvider } from "./provider";
export { MeterChat } from "./meter-chat";
export { CostCounter } from "./cost-counter";
export { ModelSelectorBar, ModelPicker } from "./model-picker";

// Hooks
export { useMeterChat } from "./use-meter-chat";
export { useMeterContext } from "./provider";

// Types
export type {
  MeterChatMessage,
  MeterModel,
  MeterProviderConfig,
  MeterChatProps,
} from "./types";

// Re-export SDK client for advanced usage
export { MeterClient, MeterError } from "@getmeter/sdk";
export type {
  ChatMessage,
  ChatOptions,
  MeterConfig,
  MeterEvent,
  DeltaEvent,
  UsageEvent,
  DoneEvent,
  Session,
  HistoryMessage,
  BillingStatus,
} from "@getmeter/sdk";
