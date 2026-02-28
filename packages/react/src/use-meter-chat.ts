import { useCallback, useEffect, useRef, useState } from "react";
import { useMeterContext } from "./provider";
import type { MeterChatMessage } from "./types";
import type { MeterEvent } from "@meterxyz/sdk";

interface UseMeterChatOptions {
  userId: string;
  sessionId?: string;
  model?: string;
  onMessage?: (message: MeterChatMessage) => void;
}

interface UseMeterChatReturn {
  messages: MeterChatMessage[];
  sendMessage: (content: string) => Promise<void>;
  isStreaming: boolean;
  sessionCost: number;
  currentMessageCost: number;
  model: string;
  setModel: (id: string) => void;
  error: string | null;
}

export function useMeterChat(options: UseMeterChatOptions): UseMeterChatReturn {
  const { client, config, models } = useMeterContext();
  const [messages, setMessages] = useState<MeterChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [currentMessageCost, setCurrentMessageCost] = useState(0);
  const [model, setModel] = useState(options.model ?? config.defaultModel ?? "auto");
  const [error, setError] = useState<string | null>(null);
  const historyLoaded = useRef(false);

  // Load history on mount if sessionId provided
  useEffect(() => {
    if (!options.sessionId || historyLoaded.current) return;
    historyLoaded.current = true;

    client
      .getHistory(options.userId, options.sessionId)
      .then((history) => {
        if (history.length > 0) {
          const msgs: MeterChatMessage[] = history.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            model: m.model ?? undefined,
            tokensIn: m.tokensIn ?? undefined,
            tokensOut: m.tokensOut ?? undefined,
            cost: m.cost ?? undefined,
            timestamp: m.timestamp,
          }));
          setMessages(msgs);
          setSessionCost(msgs.reduce((sum, m) => sum + (m.cost ?? 0), 0));
        }
      })
      .catch(() => {
        // History load failed silently — start fresh
      });
  }, [client, options.userId, options.sessionId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (isStreaming || !content.trim()) return;
      setError(null);
      setIsStreaming(true);
      setCurrentMessageCost(0);

      const userMsg: MeterChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      options.onMessage?.(userMsg);

      // Build conversation for API
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const assistantMsg: MeterChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_a`,
        role: "assistant",
        content: "",
        model,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      try {
        const currentModel = models.find((m) => m.id === model) ?? models[0];
        const stream = await client.chat({
          messages: apiMessages,
          model,
          endUserId: options.userId,
          sessionId: options.sessionId,
        });

        let fullContent = "";
        let tokensOut = 0;
        let tokensIn = 0;

        for await (const event of stream as AsyncIterable<MeterEvent>) {
          if (event.type === "delta") {
            fullContent += event.content;
            tokensOut = event.tokensOut;
            const estCost = tokensOut * currentModel.outputPrice;
            setCurrentMessageCost(estCost);

            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: fullContent,
                  tokensOut,
                };
              }
              return updated;
            });
          } else if (event.type === "usage") {
            tokensIn = event.tokensIn;
            tokensOut = event.tokensOut;
          } else if (event.type === "error") {
            setError(event.message);
          }
        }

        // Finalize cost
        const finalCost =
          tokensIn * currentModel.inputPrice +
          tokensOut * currentModel.outputPrice;

        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: fullContent,
              tokensIn,
              tokensOut,
              cost: finalCost,
            };
          }
          return updated;
        });

        setSessionCost((prev) => prev + finalCost);
        setCurrentMessageCost(0);

        const finalMsg: MeterChatMessage = {
          ...assistantMsg,
          content: fullContent,
          tokensIn,
          tokensOut,
          cost: finalCost,
        };
        options.onMessage?.(finalMsg);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat failed");
        // Remove empty assistant message on error
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
          return prev;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [client, messages, model, models, isStreaming, options]
  );

  return {
    messages,
    sendMessage,
    isStreaming,
    sessionCost,
    currentMessageCost,
    model,
    setModel,
    error,
  };
}
