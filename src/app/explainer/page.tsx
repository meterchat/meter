"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/* ── Inline SVG logos for each AI product ── */
const LogoGPT = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="18" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
    <path d="M20 8 L20 32 M8 20 L32 20 M12 12 L28 28 M28 12 L12 28" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeLinecap="round" />
    <circle cx="20" cy="20" r="4" fill="rgba(255,255,255,0.6)" />
  </svg>
);

const LogoClaude = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="5" fill="rgba(217,171,119,0.8)" />
    <g stroke="rgba(217,171,119,0.6)" strokeWidth="1.5" strokeLinecap="round">
      <line x1="20" y1="6" x2="20" y2="12" /><line x1="20" y1="28" x2="20" y2="34" />
      <line x1="6" y1="20" x2="12" y2="20" /><line x1="28" y1="20" x2="34" y2="20" />
      <line x1="10" y1="10" x2="14.5" y2="14.5" /><line x1="25.5" y1="25.5" x2="30" y2="30" />
      <line x1="30" y1="10" x2="25.5" y2="14.5" /><line x1="14.5" y1="25.5" x2="10" y2="30" />
    </g>
  </svg>
);

const LogoGemini = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 4 C20 20, 36 20, 36 20 C36 20, 20 20, 20 36 C20 36, 20 20, 4 20 C4 20, 20 20, 20 4Z" fill="url(#gem)" />
    <defs><linearGradient id="gem" x1="4" y1="4" x2="36" y2="36"><stop offset="0%" stopColor="rgba(66,133,244,0.7)" /><stop offset="100%" stopColor="rgba(219,68,55,0.7)" /></linearGradient></defs>
  </svg>
);

const LogoGrok = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M8 8 L20 20 M20 20 L32 8" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M8 32 L20 20" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M20 20 L32 32" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 4" />
  </svg>
);

const AI_PRODUCTS = [
  { name: "ChatGPT", tier: "Pro", price: "$200", logo: LogoGPT, delay: "0" },
  { name: "Claude", tier: "Pro", price: "$20", logo: LogoClaude, delay: "150" },
  { name: "Gemini", tier: "Pro", price: "$20", logo: LogoGemini, delay: "300" },
  { name: "Grok", tier: "Super", price: "$30", logo: LogoGrok, delay: "450" },
];

export default function ExplainerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const costIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalScenes = 10;

  const sceneDurations = [4500, 6000, 5500, 4000, 6000, 6000, 5500, 6000, 5000, 5000];

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
  }

  function animateScene(i: number) {
    if (i === 1) {
      document.querySelectorAll<HTMLElement>(".tool-card").forEach((card) => {
        const delay = parseInt(card.dataset.delay || "0");
        setTimeout(() => { card.style.transition = "opacity 0.6s ease, transform 0.6s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300 + delay);
        setTimeout(() => { card.classList.add("strikethrough"); }, 2200 + delay);
      });
      const total = document.querySelector<HTMLElement>(".total-bar");
      if (total) setTimeout(() => { total.style.transition = "opacity 0.6s ease, transform 0.6s ease"; total.style.opacity = "1"; total.style.transform = "translateY(0)"; }, 3200);
    }
    if (i === 2) {
      document.querySelectorAll<HTMLElement>(".model-badge").forEach((b) => {
        const delay = parseInt(b.dataset.delay || "0");
        setTimeout(() => { b.style.transition = "opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)"; b.style.opacity = "1"; b.style.transform = "scale(1)"; }, 400 + delay);
      });
    }
    if (i === 3) {
      const el = document.querySelector<HTMLElement>(".meter-logo-large");
      if (el) setTimeout(() => { el.style.transition = "opacity 1s ease, transform 1s cubic-bezier(0.16,1,0.3,1)"; el.style.opacity = "1"; el.style.transform = "scale(1)"; }, 200);
    }
    if (i === 4) {
      const el = document.getElementById("costValue");
      if (!el) return;
      let val = 0;
      if (costIntervalRef.current) clearInterval(costIntervalRef.current);
      el.textContent = "0.00";
      costIntervalRef.current = setInterval(() => {
        val += 0.001 + Math.random() * 0.002;
        if (val > 0.04) { if (costIntervalRef.current) clearInterval(costIntervalRef.current); return; }
        el.textContent = val.toFixed(3);
      }, 80);
    }
    if (i === 5) {
      const left = document.querySelector<HTMLElement>(".debater.left");
      const right = document.querySelector<HTMLElement>(".debater.right");
      const vsEl = document.querySelector<HTMLElement>(".vs-badge");
      if (left) setTimeout(() => { left.style.transition = "opacity 0.6s ease, transform 0.6s ease"; left.style.opacity = "1"; left.style.transform = "translateX(0)"; }, 300);
      if (vsEl) setTimeout(() => { vsEl.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"; vsEl.style.opacity = "1"; vsEl.style.transform = "scale(1)"; }, 700);
      if (right) setTimeout(() => { right.style.transition = "opacity 0.6s ease, transform 0.6s ease"; right.style.opacity = "1"; right.style.transform = "translateX(0)"; }, 1100);
    }
    if (i === 6) {
      const card = document.querySelector<HTMLElement>(".decision-card");
      const tapEl = document.querySelector<HTMLElement>(".tap-indicator");
      if (card) setTimeout(() => { card.style.transition = "opacity 0.7s ease, transform 0.7s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300);
      if (tapEl) setTimeout(() => { tapEl.style.transition = "opacity 0.5s ease"; tapEl.style.opacity = "1"; }, 1500);
    }
    if (i === 8) {
      const b = document.querySelector<HTMLElement>(".beta-badge");
      const url = document.querySelector<HTMLElement>(".cta-url");
      const sub = document.getElementById("ctaSub");
      if (b) setTimeout(() => { b.style.transition = "opacity 0.5s ease"; b.style.opacity = "1"; }, 200);
      if (url) setTimeout(() => { url.style.transition = "opacity 0.7s ease, transform 0.7s ease"; url.style.opacity = "1"; url.style.transform = "translateY(0)"; }, 600);
      if (sub) setTimeout(() => { sub.style.transition = "opacity 0.5s ease"; sub.style.opacity = "1"; }, 1200);
    }
    if (i === 9) {
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

        {/* Scene 1: Intelligence metered */}
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

        {/* Scene 2: Four subscriptions */}
        <div className={`scene ${current === 1 ? "active" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">Why pay hundreds a month for four separate AI tools?</div>
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
            <div className="total-label">for tools you barely max out</div>
          </div>
        </div>

        {/* Scene 3: Pay per thought */}
        <div className={`scene ${current === 2 ? "active" : ""}`}>
          <div className="model-badges">
            {["GPT-4o", "Claude Opus", "Gemini Pro", "DeepSeek R1", "Grok 4"].map((m, i) => (
              <div key={m} className="model-badge" data-delay={String(i * 100)}>{m}</div>
            ))}
          </div>
          <div className="scene-text">
            <div className="headline">Pay per thought.</div>
            <div className="subtext">All top models debating your ideas in real time.</div>
          </div>
        </div>

        {/* Scene 4: Introducing Meter */}
        <div className={`scene ${current === 3 ? "active" : ""}`}>
          <div className="meter-logo-large">
            <div className="logo-text">meter</div>
          </div>
          <div className="tagline-intro">The first pay-per-thought AI.</div>
        </div>

        {/* Scene 5: Think first, pay later */}
        <div className={`scene ${current === 4 ? "active" : ""}`}>
          <div className="cost-stream">
            <div className="message-bubble">
              Should we use Postgres or DynamoDB for our event sourcing backend?
            </div>
            <div className="cost-ticker">
              <span className="cent">$</span><span id="costValue">0.00</span>
              <span className="label">streaming cost</span>
            </div>
          </div>
          <div className="scene-text">
            <div className="headline">Think first. Pay later.</div>
            <div className="subtext">Streams cost per message. Auto-settles to your card.</div>
          </div>
        </div>

        {/* Scene 6: Debate mode */}
        <div className={`scene ${current === 5 ? "active" : ""}`}>
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
            <div className="headline">Stress-test every idea.</div>
            <div className="subtext">Debate mode puts frontier models head to head.</div>
          </div>
        </div>

        {/* Scene 7: Decision logging */}
        <div className={`scene ${current === 6 ? "active" : ""}`}>
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
            <div className="tap-label">When you have conviction, one tap logs your decision.</div>
          </div>
        </div>

        {/* Scene 8: Future */}
        <div className={`scene ${current === 7 ? "active" : ""}`}>
          <div className="future-text">
            <div className="big">In the future, everyone will wonder why they ever bought the ability to think like they do gym memberships.</div>
          </div>
        </div>

        {/* Scene 9: CTA */}
        <div className={`scene ${current === 8 ? "active" : ""}`}>
          <div className="cta-container">
            <div className="beta-badge">Public Beta</div>
            <div className="cta-url">meter.chat</div>
            <div className="subtext" style={{ opacity: 0 }} id="ctaSub">Meter is now live. Sign up today.</div>
          </div>
        </div>

        {/* Scene 10: Closing */}
        <div className={`scene ${current === 9 ? "active" : ""}`}>
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
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  body { margin: 0; padding: 0; background: #000; overflow: hidden; }

  .explainer-root {
    width: 100vw; height: 100vh;
    background: #000; color: #fff;
    font-family: 'Space Grotesk', -apple-system, sans-serif;
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
    font-weight: 600;
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

  /* ── Scene 2: Tool cards ── */
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
  .tool-card .price { font-size: 28px; font-weight: 600; letter-spacing: -1px; color: #fff; }
  .price-period { font-size: 14px; font-weight: 300; color: rgba(255,255,255,0.35); }

  .tool-card .strike-line {
    position: absolute; width: 0; height: 1.5px; background: #ff4444;
    top: 50%; left: 10%; transform: rotate(-45deg);
    transition: width 0.4s cubic-bezier(0.16,1,0.3,1);
  }
  .tool-card.strikethrough .strike-line { width: 80%; }

  .total-bar { display: flex; align-items: center; gap: 20px; opacity: 0; transform: translateY(20px); }
  .total-amount {
    font-size: 44px; font-weight: 600; color: #ff4444; letter-spacing: -2px;
    text-decoration: line-through; text-decoration-thickness: 2px;
    text-decoration-color: rgba(255,68,68,0.6);
  }
  .total-label { font-size: 18px; color: rgba(255,255,255,0.35); font-weight: 300; }

  /* ── Scene 3: Model badges ── */
  .model-badges { display: flex; gap: 10px; margin-bottom: 48px; flex-wrap: wrap; justify-content: center; }
  .model-badge {
    padding: 10px 22px; border-radius: 100px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.6);
    letter-spacing: -0.2px;
    opacity: 0; transform: scale(0.8);
  }

  /* ── Scene 4: Logo reveal ── */
  .meter-logo-large { margin-bottom: 28px; opacity: 0; transform: scale(0.5); }
  .meter-logo-large .logo-text {
    font-size: clamp(64px, 8vw, 120px); font-weight: 700; letter-spacing: -5px;
    color: #fff;
  }
  .tagline-intro {
    font-size: clamp(18px, 1.8vw, 26px); font-weight: 300;
    color: rgba(255,255,255,0.4); letter-spacing: -0.3px;
  }

  /* ── Scene 5: Cost stream ── */
  .cost-stream { display: flex; align-items: center; gap: 40px; margin-bottom: 56px; }
  .message-bubble {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px; padding: 24px 28px; max-width: 380px;
    font-size: 15px; line-height: 1.6; color: rgba(255,255,255,0.7); font-weight: 300;
  }
  .cost-ticker {
    font-family: 'JetBrains Mono', monospace; font-size: 48px; font-weight: 600;
    color: #4ade80; letter-spacing: -2px; position: relative;
  }
  .cost-ticker .cent { font-size: 28px; color: rgba(74,222,128,0.5); vertical-align: super; }
  .cost-ticker .label {
    display: block; font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.25);
    letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;
  }

  /* ── Scene 6: Debate ── */
  .debate-arena { display: flex; gap: 32px; align-items: center; margin-bottom: 48px; }
  .debater {
    width: 280px; padding: 28px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    text-align: center; opacity: 0;
  }
  .debater.left { transform: translateX(-60px); }
  .debater.right { transform: translateX(60px); }
  .debater .model-name { font-size: 16px; font-weight: 600; margin-bottom: 14px; color: rgba(255,255,255,0.85); letter-spacing: -0.3px; }
  .debater .position { font-size: 14px; color: rgba(255,255,255,0.35); line-height: 1.6; font-weight: 300; }
  .vs-badge {
    width: 56px; height: 56px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.15);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px; color: rgba(255,255,255,0.5);
    letter-spacing: 1px;
    opacity: 0; transform: scale(0);
  }

  /* ── Scene 7: Decision card ── */
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
  .decision-card .dc-decision { font-size: 22px; font-weight: 600; margin-bottom: 14px; letter-spacing: -0.5px; color: #fff; }
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

  /* ── Scene 8: Future ── */
  .future-text { max-width: 780px; text-align: center; padding: 0 40px; }
  .future-text .big {
    font-size: clamp(28px, 3vw, 46px); font-weight: 500; letter-spacing: -1.5px; line-height: 1.3;
    color: rgba(255,255,255,0.85);
  }

  /* ── Scene 9: CTA ── */
  .cta-container { text-align: center; }
  .beta-badge {
    display: inline-block; padding: 7px 18px; border-radius: 100px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: #4ade80; font-size: 11px; font-weight: 600; letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 36px; opacity: 0;
  }
  .cta-url {
    font-size: clamp(40px, 5vw, 68px); font-weight: 700; letter-spacing: -3px;
    margin-bottom: 16px; opacity: 0; transform: translateY(20px); color: #fff;
  }

  /* ── Scene 10: Closing ── */
  .closing-logo { font-size: clamp(48px, 5vw, 76px); font-weight: 700; letter-spacing: -3px; margin-bottom: 28px; opacity: 0; color: #fff; }
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
