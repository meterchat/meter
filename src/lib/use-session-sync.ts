"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeterStore, type ReceiptStatus, type ActionCard, type Attachment } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore } from "@/lib/decisions-store";

const SYNC_INTERVAL = 10_000; // sync every 10 seconds
const SYNC_DEBOUNCE = 2_000; // debounce after message

interface ServerSession {
  id: string;
  project_name?: string;
  name?: string;
  created_at?: string;
  messages?: Record<string, unknown>[];
  total_cost?: number;
  today_cost?: number;
  today_tokens_in?: number;
  today_tokens_out?: number;
  today_message_count?: number;
  today_date?: string;
  [key: string]: unknown;
}

export function useSessionSync() {
  const userId = useMeterStore((s) => s.userId);
  const projects = useMeterStore((s) => s.projects);
  const authenticated = useMeterStore((s) => s.authenticated);
  const resetDailyIfNeeded = useMeterStore((s) => s.resetDailyIfNeeded);
  const attemptDailySettlement = useMeterStore((s) => s.attemptDailySettlement);
  const lastSyncRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayStr = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getMsUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  };

  const mapServerMessage = (m: Record<string, unknown>) => ({
    id: m.id as string,
    role: m.role as "user" | "assistant",
    content: (m.content as string) ?? "",
    model: m.model as string | undefined,
    tokensIn: m.tokens_in as number | undefined,
    tokensOut: m.tokens_out as number | undefined,
    cost: m.cost as number | undefined,
    confidence: m.confidence as number | undefined,
    settled: m.settled as boolean | undefined,
    receiptStatus: m.receipt_status as ReceiptStatus | undefined,
    signature: m.signature as string | undefined,
    txHash: m.tx_hash as string | undefined,
    cards: m.cards as ActionCard[] | undefined,
    attachments: m.attachments as Attachment[] | undefined,
    timestamp: m.timestamp as number,
  });

  const buildProjectFromSession = (
    session: ServerSession,
    existingConnectedServices?: Record<string, boolean>,
  ) => {
    const messages = Array.isArray(session.messages)
      ? session.messages.map((m: Record<string, unknown>) => mapServerMessage(m))
      : [];
    const totalFromMessages = messages
      .filter((m) => m.role === "assistant" && m.cost != null)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const totalFromSession = Number(session.total_cost ?? 0);

    return {
      id: session.id,
      name: session.project_name ?? session.name ?? session.id,
      messages,
      isStreaming: false,
      settlementError: null,
      chatBlocked: false,
      todayCost: Number(session.today_cost ?? 0),
      todayTokensIn: Number(session.today_tokens_in ?? 0),
      todayTokensOut: Number(session.today_tokens_out ?? 0),
      todayMessageCount: Number(session.today_message_count ?? 0),
      todayByModel: {},
      todayDate: session.today_date ?? todayStr(),
      totalCost: Math.max(totalFromSession, totalFromMessages),
      connectedServices: existingConnectedServices ?? {},
    };
  };

  const syncFailCountRef = useRef(0);

  const syncToServer = useCallback(async () => {
    if (!authenticated) return;

    // Create a snapshot hash to avoid unnecessary syncs
    const snapshot = JSON.stringify(
      projects.map((p) => ({
        id: p.id,
        msgCount: p.messages.length,
        lastMsg: p.messages[p.messages.length - 1]?.id,
        totalCost: p.totalCost,
      }))
    );

    if (snapshot === lastSyncRef.current) return;
    let allOk = true;

    // Sync each project as a session
    for (const project of projects) {

      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: {
              id: project.id,
              name: project.name,
              totalCost: project.totalCost,
              todayCost: project.todayCost,
              todayTokensIn: project.todayTokensIn,
              todayTokensOut: project.todayTokensOut,
              todayMessageCount: project.todayMessageCount,
              todayDate: project.todayDate,
            },
            messages: project.messages ?? [],
          }),
        });
        if (!res.ok) {
          console.warn(`[meter] Session sync failed for "${project.name}": ${res.status}`);
          allOk = false;
        }
      } catch (err) {
        console.warn("[meter] Session sync error:", err);
        allOk = false;
      }
    }

    if (allOk) {
      lastSyncRef.current = snapshot;
      syncFailCountRef.current = 0;
    } else {
      syncFailCountRef.current += 1;
      if (syncFailCountRef.current >= 3) {
        console.error(
          `[meter] Session sync has failed ${syncFailCountRef.current} consecutive times. Messages may not be saved to the server.`
        );
      }
    }
  }, [authenticated, projects]);

  // Periodic sync
  useEffect(() => {
    if (!authenticated) return;

    const interval = setInterval(syncToServer, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [authenticated, syncToServer]);

  // Debounced sync on message changes
  useEffect(() => {
    if (!authenticated) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(syncToServer, SYNC_DEBOUNCE);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [authenticated, projects, syncToServer]);

  // Reset daily counters at local midnight + attempt settlement
  useEffect(() => {
    if (!authenticated) return;

    resetDailyIfNeeded();
    attemptDailySettlement();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const ms = getMsUntilMidnight() + 50;
      timeout = setTimeout(() => {
        resetDailyIfNeeded();
        attemptDailySettlement();
        schedule();
      }, ms);
    };

    schedule();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [authenticated, resetDailyIfNeeded, attemptDailySettlement]);

  // Sync on page unload
  useEffect(() => {
    if (!authenticated) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon with Blob for reliable unload sync
      // (Blob ensures Content-Type: application/json; plain string sends as text/plain)
      for (const project of projects) {
        const blob = new Blob(
          [
            JSON.stringify({
              session: {
                id: project.id,
                name: project.name,
                totalCost: project.totalCost,
                todayCost: project.todayCost,
                todayTokensIn: project.todayTokensIn,
                todayTokensOut: project.todayTokensOut,
                todayMessageCount: project.todayMessageCount,
                todayDate: project.todayDate,
              },
              messages: project.messages,
            }),
          ],
          { type: "application/json" }
        );
        navigator.sendBeacon("/api/sessions", blob);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [authenticated, projects]);

  // Load sessions from server on mount
  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    async function loadSessions() {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) {
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }
        const data = await res.json();

        if (cancelled) return;

        if (!data.sessions?.length) {
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }

        const store = useMeterStore.getState();
        const serverSessions = data.sessions as ServerSession[];

        const localById = new Map(store.projects.map((p) => [p.id, p]));
        const hasLocalMessages = store.projects.some((p) => p.messages.length > 0);
        if (!hasLocalMessages) {
          const serverProjects = serverSessions.map((s) =>
            buildProjectFromSession(s, localById.get(s.id)?.connectedServices)
          );
          if (serverProjects.length > 0) {
            useMeterStore.setState((s) => ({
              projects: serverProjects,
              activeProjectId: serverProjects.some((p) => p.id === s.activeProjectId)
                ? s.activeProjectId
                : serverProjects[0].id,
            }));
            useMeterStore.getState().resetDailyIfNeeded();
            useMeterStore.getState().attemptDailySettlement();
            const activeSessionId = serverProjects.some((p) => p.id === store.activeProjectId)
              ? store.activeProjectId
              : serverProjects[0].id;
            useWorkspaceStore
              .getState()
              .upsertCompaniesFromSessions(serverSessions, activeSessionId);
          } else {
            useWorkspaceStore.getState().upsertCompaniesFromSessions(serverSessions, store.activeProjectId);
          }
          useMeterStore.getState().fetchConnectionStatus();
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }

        const merged = [...store.projects];
        let changed = false;

        for (const serverSession of serverSessions) {
          const serverId = serverSession.id as string;
          const localProject = localById.get(serverId);
          if (!localProject) {
            merged.push(buildProjectFromSession(serverSession));
            changed = true;
            continue;
          }

          if (localProject.messages.length === 0 && Array.isArray(serverSession.messages) && serverSession.messages.length > 0) {
            const idx = merged.findIndex((p) => p.id === serverId);
            if (idx >= 0) {
              merged[idx] = buildProjectFromSession(serverSession, localProject.connectedServices);
              changed = true;
            }
          }
        }

        let nextActiveProjectId = store.activeProjectId;
        if (changed) {
          nextActiveProjectId = merged.some((p) => p.id === store.activeProjectId)
            ? store.activeProjectId
            : merged[0]?.id ?? store.activeProjectId;
          useMeterStore.setState((s) => ({
            projects: merged,
            activeProjectId: nextActiveProjectId,
          }));
          useMeterStore.getState().resetDailyIfNeeded();
          useMeterStore.getState().attemptDailySettlement();
        }

        useWorkspaceStore.getState().upsertCompaniesFromSessions(serverSessions, nextActiveProjectId);
        useMeterStore.getState().fetchConnectionStatus();
      } catch {
        // Silent fail — localStorage still works as fallback
      } finally {
        useMeterStore.getState().setSessionsLoaded(true);
      }
    }

    loadSessions();

    // Also load decisions from server (they may not be in localStorage after logout/login)
    useDecisionsStore.getState().fetchDecisions();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);
}
