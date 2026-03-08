"use client";

import * as Sentry from "@sentry/nextjs";

export default function SentryExamplePage() {
  return (
    <div style={{ padding: 40, fontFamily: "monospace" }}>
      <h1>Sentry Test Page</h1>
      <p>Click the button to send a test error to Sentry.</p>
      <button
        style={{
          marginTop: 16,
          padding: "8px 16px",
          background: "#362d59",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
        onClick={() => {
          Sentry.startSpan({ name: "Example Frontend Span", op: "test" }, () => {
            const error = new Error("Sentry Frontend Test Error");
            Sentry.captureException(error);
            throw error;
          });
        }}
      >
        Throw Test Error
      </button>
    </div>
  );
}
