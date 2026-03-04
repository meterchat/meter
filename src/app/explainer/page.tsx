"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/* ── SVG logos ── */

// OpenAI / ChatGPT – simplified hexagonal knot
const LogoGPT = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 4.5C18.2 4.5 16.5 5.3 15.4 6.7L8.8 15.5C7.7 16.9 7.3 18.8 7.7 20.5L10.3 30.3C10.7 32.1 12 33.5 13.7 34.1L23.2 37.3C24.9 37.9 26.8 37.5 28.2 36.3L35.1 30.5C36.4 29.4 37.1 27.6 36.9 25.8L35.8 15.7C35.6 13.9 34.5 12.3 32.9 11.5L24 7C22.8 5.4 21.5 4.5 20 4.5Z" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" fill="none" />
    <circle cx="20" cy="20" r="6" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="none" />
    <path d="M14 20h12M17 14l3 6 3-6M17 26l3-6 3 6" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
  </svg>
);

// Claude / Anthropic – sparkle/starburst
const LogoClaude = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 4L22.5 16L36 14L24.5 20L36 26L22.5 24L20 36L17.5 24L4 26L15.5 20L4 14L17.5 16L20 4Z" fill="rgba(217,171,119,0.7)" />
  </svg>
);

// Gemini – four-point star (already correct)
const LogoGemini = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 4 C20 20, 36 20, 36 20 C36 20, 20 20, 20 36 C20 36, 20 20, 4 20 C4 20, 20 20, 20 4Z" fill="url(#gem)" />
    <defs><linearGradient id="gem" x1="4" y1="4" x2="36" y2="36"><stop offset="0%" stopColor="rgba(66,133,244,0.7)" /><stop offset="100%" stopColor="rgba(219,68,55,0.7)" /></linearGradient></defs>
  </svg>
);

// Grok / xAI – stylized X
const LogoGrok = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M10 10L30 30M30 10L10 30" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const AI_PRODUCTS = [
  { name: "ChatGPT", tier: "Pro", price: "$200", logo: LogoGPT, delay: "0" },
  { name: "Claude", tier: "Pro", price: "$20", logo: LogoClaude, delay: "150" },
  { name: "Gemini", tier: "Pro", price: "$20", logo: LogoGemini, delay: "300" },
  { name: "Grok", tier: "Super", price: "$30", logo: LogoGrok, delay: "450" },
];

/* Deterministic cost sequence so it's the same every load */
const COST_SEQUENCE = [
  0.001, 0.003, 0.005, 0.008, 0.010, 0.013, 0.015, 0.017,
  0.019, 0.021, 0.023, 0.025, 0.027, 0.029, 0.031, 0.033,
  0.034, 0.036, 0.037, 0.038, 0.039, 0.040,
];

/* Models used in our app */
const MODEL_LOGOS = [
  { name: "GPT-4o", Logo: LogoGPT },
  { name: "Claude Opus", Logo: LogoClaude },
  { name: "Gemini Pro", Logo: LogoGemini },
  { name: "Grok 3", Logo: LogoGrok },
  { name: "DeepSeek R1", Logo: () => (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="14" stroke="rgba(100,200,255,0.5)" strokeWidth="1.5" fill="none" />
      <circle cx="20" cy="20" r="6" fill="rgba(100,200,255,0.4)" />
    </svg>
  )},
];

export default function ExplainerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const costIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalScenes = 16;

  const sceneDurations = [
    4500, // 1: Intelligence metered
    5000, // 2: clip placeholder
    5500, // 3: why pay hundreds
    4000, // 4: pay per thought (cost stream)
    4000, // 5: all top models debate
    5000, // 6: clip placeholder
    4000, // 7: Introducing Meter
    3500, // 8: first pay per thought AI
    4500, // 9: think first pay later
    5000, // 10: chat with top models
    5000, // 11: stress test with debate
    5500, // 12: log decisions one tap
    5000, // 13: auto-settle
    5500, // 14: future gym memberships
    5000, // 15: public beta CTA
    5000, // 16: closing
  ];

  // Draw background grid
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 1920;
    canvas.height = 1080;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.02)";
    ctx.lineWidth = 1;
    const size = 80;
    for (let x = 0; x < canvas.width; x += size) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += size) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }, []);

  // Scene animations
  useEffect(() => {
    resetAllAnimations();
    const timer = setTimeout(() => animateScene(current), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function resetAllAnimations() {
    document.querySelectorAll<HTMLElement>(".tool-card").forEach((c) => {
      c.style.opacity = "0"; c.style.transform = "translateY(30px)"; c.classList.remove("strikethrough");
    });
    const totalBar = document.querySelector<HTMLElement>(".total-bar");
    if (totalBar) { totalBar.style.opacity = "0"; totalBar.style.transform = "translateY(20px)"; }
    document.querySelectorAll<HTMLElement>(".model-badge").forEach((b) => {
      b.style.opacity = "0"; b.style.transform = "scale(0.8)";
    });
    document.querySelectorAll<HTMLElement>(".model-logo-item").forEach((b) => {
      b.style.opacity = "0"; b.style.transform = "translateY(20px)";
    });
    const logo = document.querySelector<HTMLElement>(".meter-logo-large");
    if (logo) { logo.style.opacity = "0"; logo.style.transform = "scale(0.5)"; }
    if (costIntervalRef.current) clearInterval(costIntervalRef.current);
    const costEl = document.getElementById("costValue");
    if (costEl) costEl.textContent = "0.00";
    const dLeft = document.querySelector<HTMLElement>(".debater.left");
    const dRight = document.querySelector<HTMLElement>(".debater.right");
    const vs = document.querySelector<HTMLElement>(".vs-badge");
    if (dLeft) { dLeft.style.opacity = "0"; dLeft.style.transform = "translateX(-60px)"; }
    if (dRight) { dRight.style.opacity = "0"; dRight.style.transform = "translateX(60px)"; }
    if (vs) { vs.style.opacity = "0"; vs.style.transform = "scale(0)"; }
    const dc = document.querySelector<HTMLElement>(".decision-card");
    const tap = document.querySelector<HTMLElement>(".tap-indicator");
    if (dc) { dc.style.opacity = "0"; dc.style.transform = "translateY(30px)"; }
    if (tap) tap.style.opacity = "0";
    const badge = document.querySelector<HTMLElement>(".beta-badge");
    const ctaUrl = document.querySelector<HTMLElement>(".cta-url");
    const ctaSub = document.getElementById("ctaSub");
    if (badge) badge.style.opacity = "0";
    if (ctaUrl) { ctaUrl.style.opacity = "0"; ctaUrl.style.transform = "translateY(20px)"; }
    if (ctaSub) ctaSub.style.opacity = "0";
    const closingLogo = document.querySelector<HTMLElement>(".closing-logo");
    const closingTag = document.querySelector<HTMLElement>(".closing-tagline");
    if (closingLogo) closingLogo.style.opacity = "0";
    if (closingTag) closingTag.style.opacity = "0";
    // settle animation
    const settleBtn = document.querySelector<HTMLElement>(".settle-btn");
    if (settleBtn) { settleBtn.style.opacity = "0"; settleBtn.classList.remove("settling", "settled"); }
    const settleLabel = document.querySelector<HTMLElement>(".settle-label");
    if (settleLabel) settleLabel.style.opacity = "0";
  }

  function animateScene(i: number) {
    // Frame 3: subscriptions crossed out
    if (i === 2) {
      document.querySelectorAll<HTMLElement>(".tool-card").forEach((card) => {
        const delay = parseInt(card.dataset.delay || "0");
        setTimeout(() => { card.style.transition = "opacity 0.6s ease, transform 0.6s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300 + delay);
        setTimeout(() => { card.classList.add("strikethrough"); }, 2200 + delay);
      });
      const total = document.querySelector<HTMLElement>(".total-bar");
      if (total) setTimeout(() => { total.style.transition = "opacity 0.6s ease, transform 0.6s ease"; total.style.opacity = "1"; total.style.transform = "translateY(0)"; }, 3200);
    }
    // Frame 4: cost stream (deterministic)
    if (i === 3) {
      const el = document.getElementById("costValue");
      if (!el) return;
      let step = 0;
      if (costIntervalRef.current) clearInterval(costIntervalRef.current);
      el.textContent = "0.000";
      costIntervalRef.current = setInterval(() => {
        if (step >= COST_SEQUENCE.length) { if (costIntervalRef.current) clearInterval(costIntervalRef.current); return; }
        el.textContent = COST_SEQUENCE[step].toFixed(3);
        step++;
      }, 120);
    }
    // Frame 7: logo reveal
    if (i === 6) {
      const el = document.querySelector<HTMLElement>(".meter-logo-large");
      if (el) setTimeout(() => { el.style.transition = "opacity 1s ease, transform 1s cubic-bezier(0.16,1,0.3,1)"; el.style.opacity = "1"; el.style.transform = "scale(1)"; }, 200);
    }
    // Frame 10: model logos
    if (i === 9) {
      document.querySelectorAll<HTMLElement>(".model-logo-item").forEach((b) => {
        const delay = parseInt(b.dataset.delay || "0");
        setTimeout(() => { b.style.transition = "opacity 0.5s ease, transform 0.5s ease"; b.style.opacity = "1"; b.style.transform = "translateY(0)"; }, 400 + delay);
      });
    }
    // Frame 11: debate animation
    if (i === 10) {
      const left = document.querySelector<HTMLElement>(".debater.left");
      const right = document.querySelector<HTMLElement>(".debater.right");
      const vsEl = document.querySelector<HTMLElement>(".vs-badge");
      if (left) setTimeout(() => { left.style.transition = "opacity 0.6s ease, transform 0.6s ease"; left.style.opacity = "1"; left.style.transform = "translateX(0)"; }, 300);
      if (vsEl) setTimeout(() => { vsEl.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"; vsEl.style.opacity = "1"; vsEl.style.transform = "scale(1)"; }, 700);
      if (right) setTimeout(() => { right.style.transition = "opacity 0.6s ease, transform 0.6s ease"; right.style.opacity = "1"; right.style.transform = "translateX(0)"; }, 1100);
    }
    // Frame 12: decision card
    if (i === 11) {
      const card = document.querySelector<HTMLElement>(".decision-card");
      const tapEl = document.querySelector<HTMLElement>(".tap-indicator");
      if (card) setTimeout(() => { card.style.transition = "opacity 0.7s ease, transform 0.7s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300);
      if (tapEl) setTimeout(() => { tapEl.style.transition = "opacity 0.5s ease"; tapEl.style.opacity = "1"; }, 1500);
    }
    // Frame 13: settle animation
    if (i === 12) {
      const btn = document.querySelector<HTMLElement>(".settle-btn");
      const label = document.querySelector<HTMLElement>(".settle-label");
      if (btn) {
        setTimeout(() => { btn.style.transition = "opacity 0.6s ease"; btn.style.opacity = "1"; }, 300);
        setTimeout(() => { btn.classList.add("settling"); }, 1200);
        setTimeout(() => { btn.classList.remove("settling"); btn.classList.add("settled"); }, 3000);
      }
      if (label) setTimeout(() => { label.style.transition = "opacity 0.5s ease"; label.style.opacity = "1"; }, 500);
    }
    // Frame 15: CTA
    if (i === 14) {
      const b = document.querySelector<HTMLElement>(".beta-badge");
      const url = document.querySelector<HTMLElement>(".cta-url");
      const sub = document.getElementById("ctaSub");
      if (b) setTimeout(() => { b.style.transition = "opacity 0.5s ease"; b.style.opacity = "1"; }, 200);
      if (url) setTimeout(() => { url.style.transition = "opacity 0.7s ease, transform 0.7s ease"; url.style.opacity = "1"; url.style.transform = "translateY(0)"; }, 600);
      if (sub) setTimeout(() => { sub.style.transition = "opacity 0.5s ease"; sub.style.opacity = "1"; }, 1200);
    }
    // Frame 16: closing
    if (i === 15) {
      const cl = document.querySelector<HTMLElement>(".closing-logo");
      const ct = document.querySelector<HTMLElement>(".closing-tagline");
      if (cl) setTimeout(() => { cl.style.transition = "opacity 1s ease"; cl.style.opacity = "1"; }, 300);
      if (ct) setTimeout(() => { ct.style.transition = "opacity 0.8s ease"; ct.style.opacity = "1"; }, 1000);
    }
  }

  const goNext = useCallback(() => {
    setCurrent((c) => (c < totalScenes - 1 ? c + 1 : c));
  }, []);

  const goPrev = useCallback(() => {
    setCurrent((c) => (c > 0 ? c - 1 : c));
  }, []);

  const stopAutoplay = useCallback(() => {
    setPlaying(false);
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
  }, []);

  // Autoplay
  useEffect(() => {
    if (!playing) return;
    autoTimerRef.current = setTimeout(() => {
      if (current < totalScenes - 1) setCurrent((c) => c + 1);
      else setPlaying(false);
    }, sceneDurations[current]);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current]);

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); stopAutoplay(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); stopAutoplay(); goPrev(); }
      if (e.key === "p" || e.key === "P") setPlaying((p) => !p);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, stopAutoplay]);

  const progressWidth = ((current + 1) / totalScenes) * 100;
  const counterText = `${String(current + 1).padStart(2, "0")} / ${String(totalScenes).padStart(2, "0")}`;

  return (
    <>
      <style>{explainerStyles}</style>
      <div className="explainer-root">
        <canvas ref={canvasRef} id="bg" />
        <div className="glow-orb glow-1" />
        <div className="glow-orb glow-2" />
        <div className="glow-orb glow-3" />

        {/* Frame 1: Intelligence needs to be metered like electricity */}
        <div className={`scene ${current === 0 ? "active" : ""}`}>
          <div className="meter-icon">
            <div className="meter-dial">
              <div className="meter-needle" />
              <div className="meter-dot" />
            </div>
          </div>
          <div className="scene-text">
            <div className="headline">Intelligence needs to be metered like electricity.</div>
          </div>
        </div>

        {/* Frame 2: CLIP PLACEHOLDER – meter counter streaming */}
        <div className={`scene ${current === 1 ? "active" : ""}`}>
          <div className="clip-placeholder">
            <div className="clip-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <polygon points="10,8 16,12 10,16" fill="rgba(255,255,255,0.3)" stroke="none" />
              </svg>
            </div>
            <div className="clip-label">Insert clip: app meter counter streaming</div>
          </div>
        </div>

        {/* Frame 3: Why pay hundreds – four tools crossed out */}
        <div className={`scene ${current === 2 ? "active" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">Why pay hundreds of dollars a month for subscriptions you barely use.</div>
          </div>
          <div className="tools-grid">
            {AI_PRODUCTS.map((t) => {
              const Logo = t.logo;
              return (
                <div key={t.name} className="tool-card" data-delay={t.delay}>
                  <div className="tool-logo"><Logo /></div>
                  <div className="tool-name">{t.name}</div>
                  <div className="tool-tier">{t.tier}</div>
                  <div className="price">{t.price}<span className="price-period">/mo</span></div>
                  <div className="strike-line" />
                </div>
              );
            })}
          </div>
          <div className="total-bar">
            <div className="total-amount">$270/mo</div>
            <div className="total-label">for tools you barely use</div>
          </div>
        </div>

        {/* Frame 4: When you can pay per thought – cost stream */}
        <div className={`scene ${current === 3 ? "active" : ""}`}>
          <div className="cost-stream">
            <div className="cost-ticker">
              <span className="cent">$</span><span id="costValue">0.000</span>
              <span className="label">streaming cost</span>
            </div>
          </div>
          <div className="scene-text">
            <div className="headline">When you can pay per thought.</div>
          </div>
        </div>

        {/* Frame 5: All top models debate in real time */}
        <div className={`scene ${current === 4 ? "active" : ""}`}>
          <div className="model-badges">
            {["GPT-4o", "Claude Opus", "Gemini Pro", "DeepSeek R1", "Grok 3"].map((m, i) => (
              <div key={m} className="model-badge" data-delay={String(i * 100)}>{m}</div>
            ))}
          </div>
          <div className="scene-text">
            <div className="headline">And get all the top models to debate your ideas in real time.</div>
          </div>
        </div>

        {/* Frame 6: CLIP PLACEHOLDER – debate mode */}
        <div className={`scene ${current === 5 ? "active" : ""}`}>
          <div className="clip-placeholder">
            <div className="clip-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <polygon points="10,8 16,12 10,16" fill="rgba(255,255,255,0.3)" stroke="none" />
              </svg>
            </div>
            <div className="clip-label">Insert clip: debate mode</div>
          </div>
        </div>

        {/* Frame 7: Introducing Meter */}
        <div className={`scene ${current === 6 ? "active" : ""}`}>
          <div className="meter-logo-large">
            <div className="logo-text">meter</div>
          </div>
          <div className="tagline-intro">Introducing Meter.</div>
        </div>

        {/* Frame 8: The first pay per thought AI */}
        <div className={`scene ${current === 7 ? "active" : ""}`}>
          <div className="scene-text">
            <div className="headline">The first pay-per-thought AI.</div>
          </div>
        </div>

        {/* Frame 9: Think first, pay later */}
        <div className={`scene ${current === 8 ? "active" : ""}`}>
          <div className="scene-text">
            <div className="headline">Meter lets you think first, pay later.</div>
          </div>
        </div>

        {/* Frame 10: Chat with top AI models – logos animation */}
        <div className={`scene ${current === 9 ? "active" : ""}`}>
          <div className="model-logos-row">
            {MODEL_LOGOS.map((m, i) => (
              <div key={m.name} className="model-logo-item" data-delay={String(i * 120)}>
                <div className="model-logo-icon"><m.Logo /></div>
                <div className="model-logo-name">{m.name}</div>
              </div>
            ))}
          </div>
          <div className="scene-text" style={{ marginTop: 40 }}>
            <div className="headline">It lets you chat with the top AI models.</div>
          </div>
        </div>

        {/* Frame 11: Stress test with debate mode */}
        <div className={`scene ${current === 10 ? "active" : ""}`}>
          <div className="debate-arena">
            <div className="debater left">
              <div className="model-name">Claude</div>
              <div className="position">&ldquo;Postgres gives you ACID guarantees and rich querying out of the box.&rdquo;</div>
            </div>
            <div className="vs-badge">VS</div>
            <div className="debater right">
              <div className="model-name">GPT-4o</div>
              <div className="position">&ldquo;DynamoDB scales horizontally with zero operational overhead.&rdquo;</div>
            </div>
          </div>
          <div className="scene-text">
            <div className="headline">Stress test your ideas with debate mode.</div>
          </div>
        </div>

        {/* Frame 12: Log decisions with one tap */}
        <div className={`scene ${current === 11 ? "active" : ""}`}>
          <div className="decision-card">
            <div className="dc-header">
              <div className="dc-title">Decision Record</div>
              <div className="dc-status">Locked</div>
            </div>
            <div className="dc-decision">Use Postgres with JSONB columns</div>
            <div className="dc-meta">
              Trade-off: Less horizontal scale, but ACID + rich queries outweigh for current traffic.<br />
              Debated by Claude &amp; GPT-4o &bull; March 4, 2026
            </div>
          </div>
          <div className="tap-indicator">
            <div className="tap-circle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
            <div className="tap-label">When you have conviction, log your decisions with one tap.</div>
          </div>
        </div>

        {/* Frame 13: Auto-settle animation */}
        <div className={`scene ${current === 12 ? "active" : ""}`}>
          <div className="settle-container">
            <div className="settle-amount">$0.042</div>
            <div className="settle-btn">
              <span className="settle-text-default">Settle</span>
              <span className="settle-text-settling">
                <svg className="settle-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Settling...
              </span>
              <span className="settle-text-settled">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Settled
              </span>
            </div>
            <div className="settle-label">Meter auto-settles your spend to your saved card on an ongoing basis.</div>
          </div>
        </div>

        {/* Frame 14: Future / gym memberships */}
        <div className={`scene ${current === 13 ? "active" : ""}`}>
          <div className="future-text">
            <div className="big">In the future everyone will wonder why they ever bought the ability to think like they do gym memberships.</div>
          </div>
        </div>

        {/* Frame 15: Public beta CTA */}
        <div className={`scene ${current === 14 ? "active" : ""}`}>
          <div className="cta-container">
            <div className="beta-badge">Public Beta</div>
            <div className="cta-url">meter.chat</div>
            <div className="subtext" style={{ opacity: 0 }} id="ctaSub">Meter is now live in public beta. Sign up at meter.chat</div>
          </div>
        </div>

        {/* Frame 16: Closing */}
        <div className={`scene ${current === 15 ? "active" : ""}`}>
          <div className="closing-logo">meter</div>
          <div className="closing-tagline">Think in <em>Meter</em>. Pay per thought.</div>
        </div>

        <div className="progress-bar" style={{ width: `${progressWidth}%` }} />
        <div className="scene-counter">{counterText}</div>
        <div className="controls">
          <button onClick={() => { stopAutoplay(); goPrev(); }} title="Previous">&lsaquo;</button>
          <button onClick={() => setPlaying((p) => !p)} title="Play/Pause">{playing ? "\u23F8" : "\u25B6"}</button>
          <button onClick={() => { stopAutoplay(); goNext(); }} title="Next">&rsaquo;</button>
        </div>
      </div>
    </>
  );
}

const explainerStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  body { margin: 0; padding: 0; background: #000; overflow: hidden; }

  .explainer-root {
    width: 100vw; height: 100vh;
    background: #000; color: #fff;
    font-family: 'Inter', -apple-system, sans-serif;
    overflow: hidden; position: relative;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  canvas#bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; }

  .scene {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center; flex-direction: column;
    z-index: 1; opacity: 0; transform: scale(0.97);
    transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
    pointer-events: none;
  }
  .scene.active { opacity: 1; transform: scale(1); pointer-events: auto; }

  /* ── Typography ── */
  .scene-text { text-align: center; max-width: 900px; padding: 0 40px; }

  .headline {
    font-size: clamp(32px, 3.5vw, 56px);
    font-weight: 500;
    letter-spacing: -1.5px;
    line-height: 1.15;
    margin-bottom: 16px;
    color: #fff;
  }

  .subtext {
    font-size: clamp(15px, 1.3vw, 21px);
    font-weight: 300;
    color: rgba(255,255,255,0.45);
    line-height: 1.6;
    letter-spacing: -0.2px;
  }

  /* ── Scene 1: Meter icon ── */
  .meter-icon { width: 160px; height: 160px; margin-bottom: 48px; position: relative; }
  .meter-dial {
    width: 160px; height: 160px; border: 2px solid rgba(255,255,255,0.12);
    border-radius: 50%; position: relative; display: flex; align-items: center; justify-content: center;
  }
  .meter-dial::before { content: ''; position: absolute; inset: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.04); }
  .meter-needle {
    width: 2px; height: 60px; background: linear-gradient(to top, #fff, rgba(255,255,255,0.15));
    position: absolute; bottom: 50%; left: 50%; transform-origin: bottom center;
    transform: translateX(-50%) rotate(-60deg); border-radius: 2px;
    animation: needleSweep 3s cubic-bezier(0.34,1.56,0.64,1) forwards;
  }
  .meter-dot { width: 8px; height: 8px; background: #fff; border-radius: 50%; position: absolute; z-index: 2; }
  @keyframes needleSweep { 0% { transform: translateX(-50%) rotate(-60deg); } 100% { transform: translateX(-50%) rotate(60deg); } }

  /* ── Clip placeholder ── */
  .clip-placeholder {
    display: flex; flex-direction: column; align-items: center; gap: 24px;
    padding: 60px 80px; border-radius: 20px;
    border: 2px dashed rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.02);
  }
  .clip-icon { opacity: 0.4; }
  .clip-label {
    font-size: 15px; font-weight: 400; color: rgba(255,255,255,0.25);
    letter-spacing: -0.2px;
  }

  /* ── Tool cards ── */
  .tools-grid { display: flex; gap: 20px; margin-bottom: 48px; }

  .tool-card {
    width: 180px; height: 240px; border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    opacity: 0; transform: translateY(30px); position: relative; overflow: hidden;
    transition: border-color 0.4s;
  }
  .tool-card::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(255,50,50,0.06) 0%, transparent 60%);
    opacity: 0; transition: opacity 0.6s;
  }
  .tool-card.strikethrough { border-color: rgba(255,68,68,0.2); }
  .tool-card.strikethrough::before { opacity: 1; }

  .tool-logo { margin-bottom: 4px; opacity: 0.8; }
  .tool-name { font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.85); letter-spacing: -0.3px; }
  .tool-tier { font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.5px; }
  .tool-card .price { font-size: 28px; font-weight: 500; letter-spacing: -1px; color: #fff; }
  .price-period { font-size: 14px; font-weight: 300; color: rgba(255,255,255,0.35); }

  .tool-card .strike-line {
    position: absolute; width: 0; height: 1.5px; background: #ff4444;
    top: 50%; left: 10%; transform: rotate(-45deg);
    transition: width 0.4s cubic-bezier(0.16,1,0.3,1);
  }
  .tool-card.strikethrough .strike-line { width: 80%; }

  .total-bar { display: flex; align-items: center; gap: 20px; opacity: 0; transform: translateY(20px); }
  .total-amount {
    font-size: 44px; font-weight: 500; color: #ff4444; letter-spacing: -2px;
    text-decoration: line-through; text-decoration-thickness: 2px;
    text-decoration-color: rgba(255,68,68,0.6);
  }
  .total-label { font-size: 18px; color: rgba(255,255,255,0.35); font-weight: 300; }

  /* ── Model badges (frame 5) ── */
  .model-badges { display: flex; gap: 10px; margin-bottom: 48px; flex-wrap: wrap; justify-content: center; }
  .model-badge {
    padding: 10px 22px; border-radius: 100px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.6);
    letter-spacing: -0.2px;
    opacity: 0; transform: scale(0.8);
  }

  /* ── Model logos row (frame 10) ── */
  .model-logos-row { display: flex; gap: 36px; align-items: center; justify-content: center; }
  .model-logo-item {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    opacity: 0; transform: translateY(20px);
  }
  .model-logo-icon { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
  .model-logo-icon svg { width: 32px; height: 32px; }
  .model-logo-name { font-size: 12px; font-weight: 400; color: rgba(255,255,255,0.4); letter-spacing: -0.2px; }

  /* ── Logo reveal ── */
  .meter-logo-large { margin-bottom: 28px; opacity: 0; transform: scale(0.5); }
  .meter-logo-large .logo-text {
    font-size: clamp(64px, 8vw, 120px); font-weight: 500; letter-spacing: -5px;
    color: #fff;
  }
  .tagline-intro {
    font-size: clamp(18px, 1.8vw, 26px); font-weight: 300;
    color: rgba(255,255,255,0.4); letter-spacing: -0.3px;
  }

  /* ── Cost stream ── */
  .cost-stream { display: flex; align-items: center; gap: 40px; margin-bottom: 56px; }
  .cost-ticker {
    font-family: 'JetBrains Mono', monospace; font-size: 48px; font-weight: 500;
    color: #4ade80; letter-spacing: -2px; position: relative; text-align: center;
  }
  .cost-ticker .cent { font-size: 28px; color: rgba(74,222,128,0.5); vertical-align: super; }
  .cost-ticker .label {
    display: block; font-family: 'Inter', sans-serif;
    font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.25);
    letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;
  }

  /* ── Debate ── */
  .debate-arena { display: flex; gap: 32px; align-items: center; margin-bottom: 48px; }
  .debater {
    width: 280px; padding: 28px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    text-align: center; opacity: 0;
  }
  .debater.left { transform: translateX(-60px); }
  .debater.right { transform: translateX(60px); }
  .debater .model-name { font-size: 16px; font-weight: 500; margin-bottom: 14px; color: rgba(255,255,255,0.85); letter-spacing: -0.3px; }
  .debater .position { font-size: 14px; color: rgba(255,255,255,0.35); line-height: 1.6; font-weight: 300; }
  .vs-badge {
    width: 56px; height: 56px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.15);
    display: flex; align-items: center; justify-content: center;
    font-weight: 600; font-size: 14px; color: rgba(255,255,255,0.5);
    letter-spacing: 1px;
    opacity: 0; transform: scale(0);
  }

  /* ── Decision card ── */
  .decision-card {
    width: 500px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    padding: 36px; margin-bottom: 40px; opacity: 0; transform: translateY(30px);
  }
  .decision-card .dc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .decision-card .dc-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.25); font-weight: 500; }
  .decision-card .dc-status {
    padding: 5px 14px; border-radius: 100px;
    background: rgba(74,222,128,0.08); color: #4ade80;
    font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  }
  .decision-card .dc-decision { font-size: 22px; font-weight: 500; margin-bottom: 14px; letter-spacing: -0.5px; color: #fff; }
  .decision-card .dc-meta { font-size: 13px; color: rgba(255,255,255,0.3); line-height: 1.7; font-weight: 300; }

  .tap-indicator { display: flex; align-items: center; gap: 12px; opacity: 0; }
  .tap-circle {
    width: 44px; height: 44px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.15);
    display: flex; align-items: center; justify-content: center;
    animation: tapPulse 1.5s ease-in-out infinite;
  }
  @keyframes tapPulse { 0%, 100% { transform: scale(1); border-color: rgba(255,255,255,0.15); } 50% { transform: scale(0.92); border-color: rgba(255,255,255,0.4); } }
  .tap-label { font-size: 15px; color: rgba(255,255,255,0.35); font-weight: 300; }

  /* ── Settle animation ── */
  .settle-container { display: flex; flex-direction: column; align-items: center; gap: 28px; }
  .settle-amount {
    font-family: 'JetBrains Mono', monospace;
    font-size: 56px; font-weight: 500; color: #4ade80; letter-spacing: -2px;
  }
  .settle-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px 48px; border-radius: 100px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.04);
    font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.7);
    letter-spacing: -0.2px; opacity: 0;
    transition: all 0.4s ease;
  }
  .settle-btn .settle-text-settling,
  .settle-btn .settle-text-settled { display: none; }
  .settle-btn.settling .settle-text-default { display: none; }
  .settle-btn.settling .settle-text-settling { display: inline-flex; align-items: center; gap: 8px; }
  .settle-btn.settling { border-color: rgba(74,222,128,0.3); }
  .settle-btn.settled .settle-text-default { display: none; }
  .settle-btn.settled .settle-text-settling { display: none; }
  .settle-btn.settled .settle-text-settled { display: inline-flex; align-items: center; gap: 8px; color: #4ade80; }
  .settle-btn.settled { border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.08); }
  .settle-spinner { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .settle-label {
    font-size: 15px; font-weight: 300; color: rgba(255,255,255,0.35);
    max-width: 460px; text-align: center; line-height: 1.6; opacity: 0;
  }

  /* ── Future ── */
  .future-text { max-width: 780px; text-align: center; padding: 0 40px; }
  .future-text .big {
    font-size: clamp(28px, 3vw, 46px); font-weight: 400; letter-spacing: -1.5px; line-height: 1.3;
    color: rgba(255,255,255,0.85);
  }

  /* ── CTA ── */
  .cta-container { text-align: center; }
  .beta-badge {
    display: inline-block; padding: 7px 18px; border-radius: 100px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: #4ade80; font-size: 11px; font-weight: 600; letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 36px; opacity: 0;
  }
  .cta-url {
    font-size: clamp(40px, 5vw, 68px); font-weight: 500; letter-spacing: -3px;
    margin-bottom: 16px; opacity: 0; transform: translateY(20px); color: #fff;
  }

  /* ── Closing ── */
  .closing-logo { font-size: clamp(48px, 5vw, 76px); font-weight: 500; letter-spacing: -3px; margin-bottom: 28px; opacity: 0; color: #fff; }
  .closing-tagline { font-size: clamp(18px, 1.8vw, 26px); font-weight: 300; color: rgba(255,255,255,0.35); letter-spacing: -0.3px; opacity: 0; }
  .closing-tagline em { font-style: normal; color: rgba(255,255,255,0.7); font-weight: 500; }

  /* ── Chrome ── */
  .progress-bar { position: fixed; bottom: 0; left: 0; height: 2px; background: linear-gradient(90deg, rgba(255,255,255,0.5), rgba(255,255,255,0.15)); z-index: 100; transition: width 0.3s ease; }

  .controls { position: fixed; bottom: 32px; right: 32px; z-index: 100; display: flex; gap: 10px; }
  .controls button {
    width: 44px; height: 44px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.6); font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(10px); transition: all 0.2s;
  }
  .controls button:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #fff; }

  .scene-counter {
    position: fixed; bottom: 38px; left: 50%; transform: translateX(-50%);
    font-size: 11px; color: rgba(255,255,255,0.15); letter-spacing: 3px; z-index: 100; font-weight: 400;
  }

  .glow-orb { position: fixed; border-radius: 50%; filter: blur(120px); z-index: 0; pointer-events: none; }
  .glow-1 { width: 600px; height: 600px; background: rgba(99,102,241,0.06); top: -200px; right: -200px; }
  .glow-2 { width: 500px; height: 500px; background: rgba(74,222,128,0.04); bottom: -200px; left: -100px; }
  .glow-3 { width: 400px; height: 400px; background: rgba(251,191,36,0.03); top: 50%; left: 50%; transform: translate(-50%,-50%); }
`;
