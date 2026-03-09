"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Image from "next/image";

/* ── Model logos from public assets ── */

const LogoGPT = () => (
  <Image src="/openai.webp" alt="OpenAI" width={40} height={40} className="rounded-md object-contain" draggable={false} />
);

const LogoClaude = () => (
  <Image src="/claude.webp" alt="Claude" width={40} height={40} className="rounded-md object-contain" draggable={false} />
);

const LogoGemini = () => (
  <Image src="/gemini.webp" alt="Gemini" width={40} height={40} className="rounded-md object-contain" draggable={false} />
);

const LogoGrok = () => (
  <Image src="/grok.webp" alt="Grok" width={40} height={40} className="rounded-md object-contain" draggable={false} />
);

const LogoDeepSeek = () => (
  <Image src="/deepseek.webp" alt="DeepSeek" width={40} height={40} className="rounded-md object-contain" draggable={false} />
);

const AI_PRODUCTS = [
  { name: "ChatGPT", tier: "Pro", price: "$200", logo: LogoGPT, delay: "0" },
  { name: "Claude", tier: "Pro", price: "$20", logo: LogoClaude, delay: "150" },
  { name: "Gemini", tier: "Pro", price: "$20", logo: LogoGemini, delay: "300" },
  { name: "Grok", tier: "Super", price: "$30", logo: LogoGrok, delay: "450" },
];

const COST_SEQUENCE = [
  0.001, 0.003, 0.005, 0.008, 0.010, 0.013, 0.015, 0.017,
  0.019, 0.021, 0.023, 0.025, 0.027, 0.029, 0.031, 0.033,
  0.034, 0.036, 0.037, 0.038, 0.039, 0.040,
];

const MODEL_BADGES = [
  { name: "GPT-4o", Logo: LogoGPT },
  { name: "Claude Opus", Logo: LogoClaude },
  { name: "Gemini Pro", Logo: LogoGemini },
  { name: "Grok 3", Logo: LogoGrok },
  { name: "DeepSeek R1", Logo: LogoDeepSeek },
];

const CLIP_PLACEHOLDER = (
  <div className="clip-placeholder">
    <div className="clip-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="20" rx="4" />
        <polygon points="10,8 16,12 10,16" fill="rgba(255,255,255,0.3)" stroke="none" />
      </svg>
    </div>
  </div>
);

export default function ExplainerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [visible, setVisible] = useState(0);
  const [fading, setFading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const costIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalScenes = 15;
  const FADE_OUT_MS = 400;
  const FADE_IN_MS = 400;

  const sceneDurations = [
    5500, // 1: why pay hundreds
    4000, // 2: pay per thought
    4500, // 3: intelligence metered
    4000, // 4: introducing meter
    3500, // 5: first pay per thought AI
    5000, // 6: clip placeholder
    4500, // 7: think first pay later
    5000, // 8: chat with top models (pills with logos)
    4500, // 9: debate in real time
    5000, // 10: clip placeholder
    7500, // 11: log decisions
    5000, // 12: auto-settle
    4500, // 13: spend time thinking
    5000, // 14: public beta CTA
    5000, // 15: closing tagline
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 1920; canvas.height = 1080;
    ctx.clearRect(0, 0, 1920, 1080);
    ctx.strokeStyle = "rgba(255,255,255,0.02)"; ctx.lineWidth = 1;
    for (let x = 0; x < 1920; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1080); ctx.stroke(); }
    for (let y = 0; y < 1080; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1920, y); ctx.stroke(); }
  }, []);

  useEffect(() => {
    if (current === visible && !fading) return;
    // Phase 1: fade out current scene
    setFading(true);
    if (transitionRef.current) clearTimeout(transitionRef.current);
    transitionRef.current = setTimeout(() => {
      // Phase 2: at black, swap content and reset animations
      resetAll();
      setVisible(current);
      // Phase 3: small delay then fade in
      transitionRef.current = setTimeout(() => {
        setFading(false);
        animate(current);
      }, 80);
    }, FADE_OUT_MS);
    return () => { if (transitionRef.current) clearTimeout(transitionRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Initial mount: show first scene
  useEffect(() => {
    setFading(false);
    setVisible(0);
    const t = setTimeout(() => animate(0), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetAll() {
    document.querySelectorAll<HTMLElement>(".tool-card").forEach((c) => {
      c.style.opacity = "0"; c.style.transform = "translateY(30px)";
    });
    document.querySelectorAll<HTMLElement>(".model-pill").forEach((b) => {
      b.style.opacity = "0"; b.style.transform = "scale(0.8)";
    });
    const logo = document.querySelector<HTMLElement>(".meter-logo-large");
    if (logo) { logo.style.opacity = "0"; logo.style.transform = "scale(0.5)"; }
    if (costIntervalRef.current) clearInterval(costIntervalRef.current);
    const costEl = document.getElementById("costValue");
    if (costEl) costEl.textContent = "0.000";
    const dLeft = document.querySelector<HTMLElement>(".debater.left");
    const dRight = document.querySelector<HTMLElement>(".debater.right");
    const vs = document.querySelector<HTMLElement>(".vs-badge");
    if (dLeft) { dLeft.style.opacity = "0"; dLeft.style.transform = "translateX(-60px)"; }
    if (dRight) { dRight.style.opacity = "0"; dRight.style.transform = "translateX(60px)"; }
    if (vs) { vs.style.opacity = "0"; vs.style.transform = "scale(0)"; }
    const dc = document.querySelector<HTMLElement>(".decision-card");
    if (dc) { dc.style.opacity = "0"; dc.style.transform = "translateY(30px)"; dc.style.position = "relative"; }
    const dLog = document.querySelector<HTMLElement>(".decision-log");
    if (dLog) { dLog.style.opacity = "0"; }
    document.querySelectorAll<HTMLElement>(".log-entry").forEach((l) => {
      l.style.opacity = "0"; l.style.transform = "translateY(10px)";
    });
    const settleBtn = document.querySelector<HTMLElement>(".settle-btn");
    if (settleBtn) { settleBtn.style.opacity = "0"; settleBtn.classList.remove("settling", "settled"); }
    const badge = document.querySelector<HTMLElement>(".beta-badge");
    const ctaUrl = document.querySelector<HTMLElement>(".cta-url");
    if (badge) badge.style.opacity = "0";
    if (ctaUrl) { ctaUrl.style.opacity = "0"; ctaUrl.style.transform = "translateY(20px)"; }
    const ct = document.querySelector<HTMLElement>(".closing-tagline");
    if (ct) ct.style.opacity = "0";
  }

  function animate(i: number) {
    // Frame 1: tool cards fade in (no strikethrough)
    if (i === 0) {
      document.querySelectorAll<HTMLElement>(".tool-card").forEach((card) => {
        const delay = parseInt(card.dataset.delay || "0");
        setTimeout(() => { card.style.transition = "opacity 0.6s ease, transform 0.6s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300 + delay);
      });
    }
    // Frame 2: cost stream
    if (i === 1) {
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
    // Frame 4: logo reveal
    if (i === 3) {
      const el = document.querySelector<HTMLElement>(".meter-logo-large");
      if (el) setTimeout(() => { el.style.transition = "opacity 1s ease, transform 1s cubic-bezier(0.16,1,0.3,1)"; el.style.opacity = "1"; el.style.transform = "scale(1)"; }, 200);
    }
    // Frame 8: model pills with logos
    if (i === 7) {
      document.querySelectorAll<HTMLElement>(".model-pill").forEach((b) => {
        const delay = parseInt(b.dataset.delay || "0");
        setTimeout(() => { b.style.transition = "opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)"; b.style.opacity = "1"; b.style.transform = "scale(1)"; }, 400 + delay);
      });
    }
    // Frame 9: debate animation
    if (i === 8) {
      const left = document.querySelector<HTMLElement>(".debater.left");
      const right = document.querySelector<HTMLElement>(".debater.right");
      const vsEl = document.querySelector<HTMLElement>(".vs-badge");
      if (left) setTimeout(() => { left.style.transition = "opacity 0.6s ease, transform 0.6s ease"; left.style.opacity = "1"; left.style.transform = "translateX(0)"; }, 300);
      if (vsEl) setTimeout(() => { vsEl.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"; vsEl.style.opacity = "1"; vsEl.style.transform = "scale(1)"; }, 700);
      if (right) setTimeout(() => { right.style.transition = "opacity 0.6s ease, transform 0.6s ease"; right.style.opacity = "1"; right.style.transform = "translateX(0)"; }, 1100);
    }
    // Frame 11: decision card appears → fades to scrolling log
    if (i === 10) {
      const card = document.querySelector<HTMLElement>(".decision-card");
      const log = document.querySelector<HTMLElement>(".decision-log");
      const entries = document.querySelectorAll<HTMLElement>(".log-entry");
      // Step 1: card fades in at full size
      if (card) setTimeout(() => { card.style.transition = "opacity 0.7s ease, transform 0.7s ease"; card.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 300);
      // Step 2: card fades out, log appears
      if (card) setTimeout(() => { card.style.transition = "opacity 0.4s ease"; card.style.opacity = "0"; card.style.position = "absolute"; }, 2400);
      if (log) setTimeout(() => { log.style.transition = "opacity 0.3s ease"; log.style.opacity = "1"; }, 2800);
      // Step 3: log entries appear one by one
      entries.forEach((entry) => {
        const delay = parseInt(entry.dataset.delay || "0");
        setTimeout(() => { entry.style.transition = "opacity 0.4s ease, transform 0.4s ease"; entry.style.opacity = "1"; entry.style.transform = "translateY(0)"; }, 2900 + delay);
      });
    }
    // Frame 12: settle
    if (i === 11) {
      const btn = document.querySelector<HTMLElement>(".settle-btn");
      if (btn) {
        setTimeout(() => { btn.style.transition = "opacity 0.6s ease"; btn.style.opacity = "1"; }, 300);
        setTimeout(() => { btn.classList.add("settling"); }, 1200);
        setTimeout(() => { btn.classList.remove("settling"); btn.classList.add("settled"); }, 3000);
      }
    }
    // Frame 14: CTA
    if (i === 13) {
      const b = document.querySelector<HTMLElement>(".beta-badge");
      const url = document.querySelector<HTMLElement>(".cta-url");
      if (b) setTimeout(() => { b.style.transition = "opacity 0.5s ease"; b.style.opacity = "1"; }, 200);
      if (url) setTimeout(() => { url.style.transition = "opacity 0.7s ease, transform 0.7s ease"; url.style.opacity = "1"; url.style.transform = "translateY(0)"; }, 600);
    }
    // Frame 15: closing
    if (i === 14) {
      const ct = document.querySelector<HTMLElement>(".closing-tagline");
      if (ct) setTimeout(() => { ct.style.transition = "opacity 1s ease"; ct.style.opacity = "1"; }, 300);
    }
  }

  const goNext = useCallback(() => setCurrent((c) => (c < totalScenes - 1 ? c + 1 : c)), []);
  const goPrev = useCallback(() => setCurrent((c) => (c > 0 ? c - 1 : c)), []);
  const stopAutoplay = useCallback(() => {
    setPlaying(false);
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!playing) return;
    autoTimerRef.current = setTimeout(() => {
      if (current < totalScenes - 1) setCurrent((c) => c + 1);
      else setPlaying(false);
    }, sceneDurations[current]);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current]);

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

  return (
    <>
      <style>{styles}</style>
      <div className="explainer-root">
        <canvas ref={canvasRef} id="bg" />
        <div className="glow-orb glow-1" />
        <div className="glow-orb glow-2" />
        <div className="glow-orb glow-3" />

        {/* 1: Why pay hundreds */}
        <div className={`scene ${visible === 0 ? "active" : ""} ${fading ? "fading" : ""}`}>
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
                </div>
              );
            })}
          </div>
        </div>

        {/* 2: When you can pay per thought */}
        <div className={`scene ${visible === 1 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">When you can pay per thought.</div>
          </div>
          <div className="cost-stream">
            <div className="cost-ticker">
              <span className="cent">$</span><span id="costValue">0.000</span>
              <span className="label">streaming cost</span>
            </div>
          </div>
        </div>

        {/* 3: Intelligence metered like electricity */}
        <div className={`scene ${visible === 2 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text">
            <div className="headline">Intelligence needs to be metered like electricity.</div>
          </div>
        </div>

        {/* 4: Introducing Meter */}
        <div className={`scene ${visible === 3 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="intro-label">Introducing</div>
          <div className="meter-logo-large">
            <Image src="/logo-dark.webp" alt="Meter" width={380} height={95} style={{ width: "clamp(220px, 26vw, 380px)", height: "auto" }} priority />
          </div>
        </div>

        {/* 5: The first pay per thought AI */}
        <div className={`scene ${visible === 4 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text">
            <div className="headline">The first pay-per-thought AI.</div>
          </div>
        </div>

        {/* 6: Clip – meter counter streaming */}
        <div className={`scene ${visible === 5 ? "active" : ""} ${fading ? "fading" : ""}`}>
          {CLIP_PLACEHOLDER}
          <div className="clip-label">Insert clip: app meter counter streaming</div>
        </div>

        {/* 7: Think first, pay later */}
        <div className={`scene ${visible === 6 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text">
            <div className="headline">Meter lets you think first, pay later.</div>
          </div>
        </div>

        {/* 8: Chat with top AI models – pills with logos */}
        <div className={`scene ${visible === 7 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">It lets you chat with the top AI models.</div>
          </div>
          <div className="model-pills">
            {MODEL_BADGES.map((m, i) => (
              <div key={m.name} className="model-pill" data-delay={String(i * 100)}>
                <span className="pill-logo"><m.Logo /></span>
                <span className="pill-name">{m.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 9: Debate in real time */}
        <div className={`scene ${visible === 8 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">And gets them to debate your ideas in real time.</div>
          </div>
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
        </div>

        {/* 10: Clip – debate mode */}
        <div className={`scene ${visible === 9 ? "active" : ""} ${fading ? "fading" : ""}`}>
          {CLIP_PLACEHOLDER}
          <div className="clip-label">Insert clip: debate mode</div>
        </div>

        {/* 11: Log decisions with one tap */}
        <div className={`scene ${visible === 10 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">And when you have conviction, log decisions with one tap.</div>
          </div>
          <div className="decision-log-area">
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
            <div className="decision-log">
              <div className="log-entry" data-delay="0">
                <span className="log-check">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="log-text">Use Postgres with JSONB columns</span>
                <span className="log-models">Claude &amp; GPT-4o</span>
              </div>
              <div className="log-entry" data-delay="250">
                <span className="log-check">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="log-text">Ship Stripe billing on day one</span>
                <span className="log-models">GPT-4o &amp; Gemini</span>
              </div>
              <div className="log-entry" data-delay="500">
                <span className="log-check">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="log-text">Deploy on Vercel, not AWS</span>
                <span className="log-models">Claude &amp; DeepSeek</span>
              </div>
              <div className="log-entry" data-delay="750">
                <span className="log-check">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="log-text">Use Tailwind over custom CSS</span>
                <span className="log-models">Gemini &amp; Grok</span>
              </div>
            </div>
          </div>
        </div>

        {/* 12: Auto-settle */}
        <div className={`scene ${visible === 11 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text" style={{ marginBottom: 40 }}>
            <div className="headline">Meter auto-settles your ongoing spend.</div>
          </div>
          <div className="settle-container">
            <div className="settle-amount">$10.04</div>
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
          </div>
        </div>

        {/* 13: Spend time thinking, not rate-limiting */}
        <div className={`scene ${visible === 12 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="scene-text">
            <div className="headline">So you can spend your time thinking and not rate-limiting.</div>
          </div>
        </div>

        {/* 14: Public beta CTA */}
        <div className={`scene ${visible === 13 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="cta-container">
            <div className="beta-badge">Public Beta</div>
            <div className="scene-text" style={{ marginBottom: 24 }}>
              <div className="headline">Sign up at</div>
            </div>
            <div className="cta-url">meter.chat</div>
          </div>
        </div>

        {/* 15: Closing – tagline only */}
        <div className={`scene ${visible === 14 ? "active" : ""} ${fading ? "fading" : ""}`}>
          <div className="closing-tagline">Think in Meter. Pay per thought.</div>
        </div>

        <div className="progress-bar" style={{ width: `${progressWidth}%` }} />
      </div>
    </>
  );
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  body { margin: 0; padding: 0; background: #000; overflow: hidden; }

  .explainer-root {
    width: 100vw; height: 100vh;
    background: #000; color: #fff;
    font-family: 'Inter', -apple-system, sans-serif;
    overflow: hidden; position: relative;
    -webkit-font-smoothing: antialiased;
  }

  canvas#bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; }

  .scene {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center; flex-direction: column;
    z-index: 1; opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
  }
  .scene.active { opacity: 1; pointer-events: auto; }
  .scene.active.fading { opacity: 0; }

  .scene-text { text-align: center; max-width: 900px; padding: 0 40px; }

  .headline {
    font-size: clamp(32px, 3.5vw, 56px);
    font-weight: 500; letter-spacing: -1.5px;
    line-height: 1.15; margin-bottom: 16px; color: #fff;
  }

  /* ── Clip placeholder ── */
  .clip-placeholder {
    display: flex; flex-direction: column; align-items: center; gap: 24px;
    padding: 60px 80px; border-radius: 20px;
    border: 2px dashed rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.02); margin-bottom: 16px;
  }
  .clip-label { font-size: 15px; font-weight: 400; color: rgba(255,255,255,0.25); }

  /* ── Tool cards ── */
  .tools-grid { display: flex; gap: 20px; }

  .tool-card {
    width: 180px; height: 240px; border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    opacity: 0; transform: translateY(30px);
    transition: border-color 0.4s;
  }
  .tool-logo { margin-bottom: 4px; opacity: 0.8; }
  .tool-name { font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.85); letter-spacing: -0.3px; }
  .tool-tier { font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.5px; }
  .tool-card .price { font-size: 28px; font-weight: 500; letter-spacing: -1px; color: #fff; }
  .price-period { font-size: 14px; font-weight: 300; color: rgba(255,255,255,0.35); }

  /* ── Model pills with logos (frame 8) ── */
  .model-pills { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  .model-pill {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 22px 10px 12px; border-radius: 100px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    opacity: 0; transform: scale(0.8);
  }
  .pill-logo { display: flex; align-items: center; }
  .pill-logo svg { width: 22px; height: 22px; }
  .pill-name { font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.6); letter-spacing: -0.2px; }

  /* ── Logo reveal ── */
  .intro-label {
    font-size: clamp(18px, 1.8vw, 26px); font-weight: 300;
    color: rgba(255,255,255,0.4); letter-spacing: -0.3px; margin-bottom: 24px;
  }
  .meter-logo-large { margin-bottom: 28px; opacity: 0; transform: scale(0.5); }

  /* ── Cost stream ── */
  .cost-stream { display: flex; align-items: center; gap: 40px; }
  .cost-ticker {
    font-family: 'JetBrains Mono', monospace; font-size: 48px; font-weight: 500;
    color: #4ade80; letter-spacing: -2px; text-align: center;
  }
  .cost-ticker .cent { font-size: 28px; color: rgba(74,222,128,0.5); vertical-align: super; }
  .cost-ticker .label {
    display: block; font-family: 'Inter', sans-serif;
    font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.25);
    letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;
  }

  /* ── Debate ── */
  .debate-arena { display: flex; gap: 32px; align-items: center; }
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
    letter-spacing: 1px; opacity: 0; transform: scale(0);
  }

  /* ── Decision log area ── */
  .decision-log-area {
    display: flex; flex-direction: column; align-items: center;
    width: 500px; position: relative;
  }

  /* ── Decision card ── */
  .decision-card {
    width: 100%; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    padding: 36px; opacity: 0; transform: translateY(30px);
    position: relative;
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

  /* ── Decision log ── */
  .decision-log {
    width: 100%; opacity: 0;
    display: flex; flex-direction: column;
  }
  .log-entry {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    opacity: 0; transform: translateY(10px);
  }
  .log-entry:last-child { border-bottom: none; }
  .log-check { display: flex; align-items: center; flex-shrink: 0; }
  .log-text { font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.8); letter-spacing: -0.2px; flex: 1; }
  .log-models { font-size: 11px; color: rgba(255,255,255,0.2); white-space: nowrap; }

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
    letter-spacing: -0.2px; opacity: 0; transition: all 0.4s ease;
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
  .closing-tagline {
    font-size: clamp(18px, 1.8vw, 26px); font-weight: 300;
    color: rgba(255,255,255,0.5); letter-spacing: -0.3px; opacity: 0;
  }

  /* ── Chrome ── */
  .progress-bar { position: fixed; bottom: 0; left: 0; height: 2px; background: linear-gradient(90deg, rgba(255,255,255,0.5), rgba(255,255,255,0.15)); z-index: 100; transition: width 0.3s ease; }

  .glow-orb { position: fixed; border-radius: 50%; filter: blur(120px); z-index: 0; pointer-events: none; }
  .glow-1 { width: 600px; height: 600px; background: rgba(99,102,241,0.06); top: -200px; right: -200px; }
  .glow-2 { width: 500px; height: 500px; background: rgba(74,222,128,0.04); bottom: -200px; left: -100px; }
  .glow-3 { width: 400px; height: 400px; background: rgba(251,191,36,0.03); top: 50%; left: 50%; transform: translate(-50%,-50%); }
`;
