/**
 * Minimal tool-definition type for the vendored provider layer.
 *
 * Meter's full tools.ts pulls in connectors (Gmail, GitHub, Stripe, …) that
 * Meter doesn't need — the provider layer only references the `ToolDef` *shape*
 * to type its function-calling adapters. Meter v0.1 generates code as text and
 * passes an empty tools array, so this type alone is enough.
 */
export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
