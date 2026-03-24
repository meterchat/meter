export function OgImageContent() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1a1a",
        position: "relative",
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: "linear-gradient(90deg, #e5e5e5 0%, #666666 100%)",
        }}
      />

      {/* Logo */}
      <img
        src="https://meter.chat/icon-512x512.png"
        width={80}
        height={80}
        style={{ marginBottom: 24, borderRadius: 16 }}
      />

      {/* Title */}
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: "#e5e5e5",
          marginBottom: 16,
          letterSpacing: -1,
        }}
      >
        Meter
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 400,
          color: "#999999",
        }}
      >
        Pay Per Thought
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: 20,
          color: "#666666",
          marginTop: 24,
        }}
      >
        Every AI model. One bill. No subscription.
      </div>

      {/* URL */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 40,
          fontSize: 18,
          color: "#666666",
        }}
      >
        meter.chat
      </div>
    </div>
  );
}
