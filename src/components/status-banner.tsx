"use client";

export function StatusBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
      <div className="mx-auto max-w-2xl flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <p className="font-mono text-[11px] text-foreground/70 leading-relaxed">
          Meter is experiencing intermittent issues with message persistence.
          You may lose your chats on refresh or logout. We are working on a fix
          — in the interim, copy or export your chat locally.
        </p>
      </div>
    </div>
  );
}
