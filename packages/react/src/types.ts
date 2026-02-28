export interface MeterChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  timestamp: number;
}

export interface MeterModel {
  id: string;
  name: string;
  provider: string;
  inputPrice: number;
  outputPrice: number;
}

export interface MeterProviderConfig {
  apiKey: string;
  baseUrl?: string;
  /** Default model ID. Default: "auto" */
  defaultModel?: string;
  /** Available models for the picker. Uses built-in list if omitted. */
  models?: MeterModel[];
  /** Theme variant. Default: "system" */
  theme?: "light" | "dark" | "system";
}

export interface MeterChatProps {
  /** End-user ID from your auth system */
  userId: string;
  /** Session ID to continue a conversation. Auto-creates if omitted. */
  sessionId?: string;
  /** Placeholder text for the input. Default: "Ask anything..." */
  placeholder?: string;
  /** Show model selector bar. Default: true */
  showModelPicker?: boolean;
  /** Show cost counter. Default: true */
  showCostCounter?: boolean;
  /** Show file upload button. Default: true */
  showFileUpload?: boolean;
  /** Accepted file types for upload. Default: "image/*,application/pdf" */
  acceptedFileTypes?: string;
  /** Called when a message is sent or received */
  onMessage?: (message: MeterChatMessage) => void;
  /** Called when files are selected for upload */
  onFileSelect?: (files: File[]) => void;
  /** CSS class for the outer container */
  className?: string;
}
