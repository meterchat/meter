import React, { useRef, useEffect, useState, useCallback } from "react";
import { useMeterChat } from "./use-meter-chat";
import { useMeterContext } from "./provider";
import { CostCounter } from "./cost-counter";
import { ModelPicker } from "./model-picker";
import type { MeterChatProps } from "./types";

const BLINK_STYLE = `@keyframes meter-blink { 50% { opacity: 0; } }`;

export function MeterChat({
  userId,
  sessionId,
  placeholder = "Ask anything...",
  showModelPicker = true,
  showCostCounter = true,
  onMessage,
  className,
}: MeterChatProps) {
  const { models } = useMeterContext();
  const {
    messages,
    sendMessage,
    isStreaming,
    sessionCost,
    currentMessageCost,
    model,
    setModel,
    error,
  } = useMeterChat({ userId, sessionId, onMessage });

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;
    sendMessage(content);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [inputValue, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--meter-bg, #0a0a0a)",
        color: "var(--meter-text-primary, #e5e5e5)",
        fontFamily: "var(--meter-font, system-ui, -apple-system, sans-serif)",
        borderRadius: "var(--meter-radius, 12px)",
        border: "1px solid var(--meter-border, #262626)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      {(showModelPicker || showCostCounter) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid var(--meter-border, #262626)",
            fontSize: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {showModelPicker && (
              <ModelPicker
                models={models}
                selectedModelId={model}
                onSelect={setModel}
              />
            )}
          </div>
          {showCostCounter && (
            <CostCounter cost={sessionCost} currentCost={currentMessageCost} />
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "16px",
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 16px",
              color: "var(--meter-text-secondary, #888)",
              fontSize: "14px",
            }}
          >
            Send a message to start
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: "16px",
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: "12px",
                fontSize: "14px",
                lineHeight: "1.5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                ...(msg.role === "user"
                  ? {
                      background: "var(--meter-user-bubble, #262626)",
                      color: "var(--meter-text-primary, #e5e5e5)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--meter-text-primary, #e5e5e5)",
                    }),
              }}
            >
              {msg.content}
              {msg.role === "assistant" && isStreaming && msg === messages[messages.length - 1] && (
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "14px",
                    background: "var(--meter-accent, #f59e0b)",
                    marginLeft: "2px",
                    animation: "meter-blink 1s step-end infinite",
                  }}
                />
              )}
            </div>

            {/* Per-message cost */}
            {msg.role === "assistant" && msg.cost != null && msg.cost > 0 && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--meter-text-secondary, #666)",
                  fontFamily: "monospace",
                  marginTop: "2px",
                  paddingLeft: "4px",
                }}
              >
                ${msg.cost.toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            color: "#ef4444",
            borderTop: "1px solid var(--meter-border, #262626)",
          }}
        >
          {error}
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: "12px",
          borderTop: "1px solid var(--meter-border, #262626)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "8px",
            background: "var(--meter-input-bg, #171717)",
            borderRadius: "10px",
            padding: "8px 12px",
            border: "1px solid var(--meter-border, #262626)",
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isStreaming}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--meter-text-primary, #e5e5e5)",
              fontSize: "14px",
              fontFamily: "inherit",
              lineHeight: "1.5",
              maxHeight: "120px",
            }}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !inputValue.trim()}
            style={{
              background: isStreaming || !inputValue.trim()
                ? "var(--meter-text-secondary, #555)"
                : "var(--meter-accent, #f59e0b)",
              border: "none",
              borderRadius: "8px",
              width: "32px",
              height: "32px",
              cursor: isStreaming || !inputValue.trim() ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              opacity: isStreaming || !inputValue.trim() ? 0.4 : 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "6px",
            fontSize: "10px",
            color: "var(--meter-text-secondary, #555)",
          }}
        >
          Powered by Meter
        </div>
      </div>

      <style>{BLINK_STYLE}</style>
    </div>
  );
}
