import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL, DEFAULT_MARKUP_MULTIPLIER, getModel } from "@/lib/models";
import { CONNECTORS } from "@/lib/connectors";
import { useWorkspaceStore, resolveWorkspaceSessionId } from "@/lib/workspace-store";
import { useDecisionsStore } from "@/lib/decisions-store";
import { useStagingStore } from "@/lib/staging-store";
import { apiUrl } from "@/lib/api-url";

export type ReceiptStatus = "signing" | "signed" | "settled";

export interface ActionCard {
  id: string;
  type: "domain" | "service" | "action";
  title: string;
  description: string;
  cost?: number;
  status: "pending" | "approved" | "rejected";
  metadata?: Record<string, string>;
}

export interface DebateTurn {
  model: string;
  phase: "opening" | "challenge" | "rebuttal" | "vote";
  content: string;
}

export interface Attachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface DocumentPreview {
  id: string;
  filePath: string;
  content: string;
  category: string;
  saved?: boolean;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  answer?: string;
}

export interface DissectorTurn {
  persona: "first-principles" | "inversion" | "pre-mortem" | "verdict";
  content: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  confidence?: number;
  settled?: boolean;
  receiptStatus?: ReceiptStatus;
  signature?: string;
  txHash?: string;
  timestamp: number;
  cards?: ActionCard[];
  decisionId?: string;
  debateTrace?: DebateTurn[];
  pinned?: boolean;
  attachments?: Attachment[];
  thinking?: string;
  documents?: DocumentPreview[];
  hidden?: boolean;
  clarifyingQuestions?: ClarifyingQuestion[];
  dissectorTrace?: DissectorTurn[];
  isForkPoint?: boolean;
  forkResolution?: "merged" | "closed";
  isMergeEnd?: boolean;  // last message in a merged block (shows end-of-merge divider)
}

export interface PaymentCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface SettlementRecord {
  id: string;
  amount: number;
  workspaceId?: string;
  stripePaymentIntentId?: string;
  txHash?: string;
  messageCount: number;
  chargeCount: number;
  cardLast4?: string;
  cardBrand?: string;
  status: string;
  createdAt: string;
}

export interface SpendLimits {
  dailyLimit: number | null;
  monthlyLimit: number | null;
  perTxnLimit: number | null;
}

interface Session {
  id: string;
  name: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  settlementError: string | null;
  chatBlocked: boolean;
  todayCost: number;
  todayTokensIn: number;
  todayTokensOut: number;
  todayMessageCount: number;
  todayByModel: Record<string, { cost: number; count: number }>;
  todayDate: string;
  weekCost: number;
  weekKey: string;    // "YYYY-MM-DD" of Monday
  monthCost: number;
  monthKey: string;   // "YYYY-MM"
  totalCost: number;
  currentMessageCost: number;
  connectedServices: Record<string, boolean>;
  cardAssigned?: boolean;
  // Pagination state
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  oldestLoadedTimestamp: number | null;
  // Server aggregate token stats (full session, not just loaded messages)
  serverTokensIn: number;
  serverTokensOut: number;
  serverMessageCount: number;
  serverPendingBalance: number;
}

interface MeterState {
  userId: string | null;
  handle: string | null;
  email: string | null;
  accountType: "standard" | "superadmin";
  markupMultiplier: number;
  authenticated: boolean;
  cardOnFile: boolean;
  cardLast4: string | null;
  cardBrand: string | null;
  stripeCustomerId: string | null;
  connectionsLoading: boolean;

  selectedModelId: string;
  /** Debate mode — when true, selected models debate instead of single-model chat */
  debateMode: boolean;
  /** Models checked in the picker for debate (2+ models = auto-debate) */
  debateRoster: string[];
  spendingCapEnabled: boolean;
  spendingCap: number;

  sessions: Session[];
  activeSessionId: string;

  pendingCharges: {
    id: string;
    title: string;
    cost: number;
    type: "usage" | "card";
    workspaceId: string;
    paidAt?: number;
  }[];
  autoSettleThreshold: number;
  lastAutoSettleDate: string | null;
  isSettling: boolean;

  pendingInput: string | null;

  cards: PaymentCard[];
  cardsLoading: boolean;
  settlementHistory: SettlementRecord[];
  settlementHistoryLoading: boolean;
  spendLimits: SpendLimits;

  decisionMode: boolean;

  sessionsLoaded: boolean;

  inspectorOpen: boolean;
  inspectorTab: string;
  scrollToMessageId: string | null;

  /** Admin-configured global settings (from app_config table) */
  enabledModels: string[];
  enabledCommands: string[];
  freeCredit: number;

  setAdminConfig: (config: { markupMultiplier?: number; enabledModels?: string[]; enabledCommands?: string[]; freeCredit?: number }) => void;
  setAuth: (userId: string, handle: string | null, email: string | null, accountType?: "standard" | "superadmin", markupMultiplier?: number) => void;
  setSessionsLoaded: (v: boolean) => void;
  setEmail: (email: string) => void;
  setCardOnFile: (v: boolean, last4?: string, brand?: string) => void;
  setStripeCustomerId: (id: string) => void;
  connectService: (id: string) => void;
  disconnectService: (id: string) => void;
  fetchConnectionStatus: () => Promise<void>;
  disconnectServiceRemote: (id: string) => Promise<void>;
  submitApiKey: (provider: string, apiKey: string, metadata?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;

  addSession: (name: string, id?: string) => void;
  renameSession: (sessionId: string, newName: string) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setCardAssigned: (sessionId: string) => void;

  togglePinMessage: (messageId: string) => void;
  addMessage: (msg: ChatMessage, forSessionId?: string) => void;
  updateLastAssistantMessage: (content: string, tokensOut: number, forSessionId?: string) => void;
  updateLastAssistantThinking: (thinking: string, forSessionId?: string) => void;
  finalizeResponse: (tokensIn: number, tokensOut: number, confidence: number, actualModel?: string, cacheCreationTokens?: number, cacheReadTokens?: number, cacheReadRate?: number, actualCost?: number, forSessionId?: string) => void;
  setStreaming: (v: boolean, forSessionId?: string) => void;
  markSettled: (messageId: string) => void;
  settleAll: () => Promise<{ success: boolean; error?: string }>;
  getPendingBalance: () => number;
  getUnsettledMessages: () => ChatMessage[];
  clearSettlementError: () => void;

  approveCard: (messageId: string, cardId: string) => void;
  rejectCard: (messageId: string, cardId: string) => void;
  addCardToLastMessage: (card: ActionCard, forSessionId?: string) => void;
  purchaseDomain: (messageId: string, cardId: string) => Promise<{ success: boolean; error?: string }>;
  setMessageDecisionId: (decisionId: string, forSessionId?: string) => void;
  addDocumentToLastMessage: (doc: DocumentPreview, forSessionId?: string) => void;
  markDocumentSaved: (messageId: string, docId: string) => void;
  setDebateTrace: (trace: DebateTurn[], forSessionId?: string) => void;
  addClarifyingQuestions: (questions: ClarifyingQuestion[], forSessionId?: string) => void;
  updateClarifyingAnswer: (messageId: string, questionId: string, answer: string) => void;
  setDissectorTrace: (trace: DissectorTurn[], forSessionId?: string) => void;

  setPendingInput: (v: string | null) => void;

  toggleInspector: () => void;
  setInspectorOpen: (v: boolean) => void;
  setInspectorTab: (tab: string) => void;
  setScrollToMessageId: (id: string | null) => void;

  setSelectedModelId: (id: string) => void;
  setDebateMode: (on: boolean) => void;
  toggleDebateMode: () => void;
  setDebateRoster: (models: string[]) => void;
  toggleDebateRosterModel: (modelId: string) => void;
  setSpendingCapEnabled: (v: boolean) => void;
  setSpendingCap: (v: number) => void;
  setAutoSettleThreshold: (v: number) => void;
  setIsSettling: (v: boolean) => void;
  incrementCurrentMessageCost: (costDelta: number, forSessionId?: string) => void;
  setDecisionMode: (v: boolean) => void;

  fetchCards: () => Promise<void>;
  setDefaultCard: (paymentMethodId: string) => Promise<void>;
  removeCard: (paymentMethodId: string) => Promise<{ success: boolean; error?: string }>;

  fetchSettlementHistory: (workspaceId?: string) => Promise<void>;

  fetchSpendLimits: (workspaceId?: string) => Promise<void>;
  updateSpendLimits: (limits: Partial<SpendLimits>, workspaceId?: string) => Promise<void>;

  resetDailyIfNeeded: () => void;
  attemptDailySettlement: () => Promise<void>;

  // Pagination actions
  prependMessages: (sessionId: string, messages: ChatMessage[], hasMore: boolean) => void;
  fetchOlderMessages: (sessionId: string) => Promise<void>;

  // Branching actions
  createSubtrackSession: (subtrackId: string, parentSessionId: string, forkMessageId: string) => void;
  mergeSubtrackIntoParent: (subtrackId: string, parentSessionId: string, forkMessageId: string) => void;
  clearForkPoint: (parentSessionId: string, forkMessageId: string) => void;

  reset: () => void;
}

function todayStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStr() {
  return todayStr().slice(0, 7); // "YYYY-MM"
}

function mondayStr() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function createSession(id: string, name: string): Session {
  return {
    id,
    name,
    messages: [],
    isStreaming: false,
    settlementError: null,
    chatBlocked: false,
    todayCost: 0,
    todayTokensIn: 0,
    todayTokensOut: 0,
    todayMessageCount: 0,
    todayByModel: {},
    todayDate: todayStr(),
    weekCost: 0,
    weekKey: mondayStr(),
    monthCost: 0,
    monthKey: monthStr(),
    totalCost: 0,
    currentMessageCost: 0,
    connectedServices: {},
    cardAssigned: false,
    hasOlderMessages: false,
    loadingOlderMessages: false,
    oldestLoadedTimestamp: null,
    serverTokensIn: 0,
    serverTokensOut: 0,
    serverMessageCount: 0,
    serverPendingBalance: 0,
  };
}

/** Reset daily/weekly/monthly counters when period boundaries are crossed. */
function ensureDaily(session: Session): Session {
  const today = todayStr();
  const month = monthStr();
  const week = mondayStr();

  const needsDaily = session.todayDate !== today;
  // Only reset if key WAS set and is now stale (actual period boundary).
  // If key is undefined (old data), just stamp the key — don't zero the cost.
  const needsMonthReset = session.monthKey != null && session.monthKey !== month;
  const needsWeekReset = session.weekKey != null && session.weekKey !== week;
  const needsMonthInit = session.monthKey == null;
  const needsWeekInit = session.weekKey == null;

  if (!needsDaily && !needsMonthReset && !needsWeekReset && !needsMonthInit && !needsWeekInit) return session;

  return {
    ...session,
    ...(needsDaily ? {
      todayCost: 0, todayTokensIn: 0, todayTokensOut: 0,
      todayMessageCount: 0, todayByModel: {}, todayDate: today,
    } : {}),
    ...(needsMonthReset ? { monthCost: 0, monthKey: month } : {}),
    ...(needsMonthInit ? { monthKey: month } : {}),
    ...(needsWeekReset ? { weekCost: 0, weekKey: week } : {}),
    ...(needsWeekInit ? { weekKey: week } : {}),
    // Invariant: week/month totals must never be less than today's spend.
    // Migration or stale localStorage can leave these undercounted.
    ...(!needsWeekReset && !needsWeekInit && (session.weekCost ?? 0) < (needsDaily ? 0 : session.todayCost)
      ? { weekCost: session.todayCost } : {}),
    ...(!needsMonthReset && !needsMonthInit && (session.monthCost ?? 0) < (needsDaily ? 0 : session.todayCost)
      ? { monthCost: session.todayCost } : {}),
  };
}

function getActiveSession(state: MeterState): Session {
  return state.sessions.find((p) => p.id === state.activeSessionId) ?? state.sessions[0];
}

/** Get the workspace-level session, resolving subtracks to their parent workspace. */
function getWorkspaceSession(state: MeterState): Session {
  const wsId = resolveWorkspaceSessionId(state.activeSessionId);
  if (wsId && wsId !== state.activeSessionId) {
    const parent = state.sessions.find((p) => p.id === wsId);
    if (parent) return parent;
  }
  return getActiveSession(state);
}

/** Resolve a specific session by ID, falling back to the active session. */
function getSessionByIdOrActive(state: MeterState, forSessionId?: string): Session {
  if (forSessionId) {
    const match = state.sessions.find((p) => p.id === forSessionId);
    if (match) return match;
  }
  return getActiveSession(state);
}

function replaceActiveSession(state: MeterState, session: Session): Session[] {
  return state.sessions.map((p) => (p.id === session.id ? session : p));
}

function shortHex() {
  return Math.random().toString(16).slice(2, 10);
}

function buildConnectionMessage(providerId: string): ChatMessage | null {
  const connector = CONNECTORS.find((c) => c.id === providerId);
  if (!connector) return null;
  const hints = connector.tools
    .slice(0, 2)
    .map((t) => t.function.description.split(".")[0].toLowerCase().trim())
    .join(" or ");
  return {
    id: Math.random().toString(36).slice(2, 10),
    role: "assistant",
    content: `**${connector.name} connected!** I can now help you with ${connector.description}. Try asking me to ${hints}.`,
    timestamp: Date.now(),
  };
}

const initialSessions = [
  createSession("default", "My Workspace"),
];

export const useMeterStore = create<MeterState>()(
  persist(
    (set, get) => ({
      userId: null,
      handle: null,
      email: null,
      accountType: "standard" as const,
      markupMultiplier: DEFAULT_MARKUP_MULTIPLIER,
      authenticated: false,
      cardOnFile: false,
      cardLast4: null,
      cardBrand: null,
      stripeCustomerId: null,
      connectionsLoading: false,

      selectedModelId: DEFAULT_MODEL.id,
      debateMode: false,
      debateRoster: [],
      spendingCapEnabled: false,
      spendingCap: 10,

      sessions: initialSessions,
      activeSessionId: "default",

      pendingCharges: [],
      autoSettleThreshold: 10,
      lastAutoSettleDate: null,
      isSettling: false,

      cards: [],
      cardsLoading: false,
      settlementHistory: [],
      settlementHistoryLoading: false,
      spendLimits: { dailyLimit: null, monthlyLimit: null, perTxnLimit: null },

      pendingInput: null,

      decisionMode: false,

      sessionsLoaded: false,

      inspectorOpen: false,
      inspectorTab: "decisions",
      scrollToMessageId: null,

      enabledModels: [],
      enabledCommands: [],
      freeCredit: 0,

      setAdminConfig: (config) => set((s) => ({
        ...(config.markupMultiplier != null ? { markupMultiplier: config.markupMultiplier } : {}),
        ...(config.enabledModels != null ? { enabledModels: config.enabledModels } : {}),
        ...(config.enabledCommands != null ? { enabledCommands: config.enabledCommands } : {}),
        ...(config.freeCredit != null ? { freeCredit: config.freeCredit } : {}),
      })),
      setAuth: (userId: string, handle: string | null, email: string | null, accountType?: "standard" | "superadmin", markupMultiplier?: number) => set({ userId, handle, email, accountType: accountType ?? "standard", markupMultiplier: markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER, authenticated: true }),
      setSessionsLoaded: (v) => set({ sessionsLoaded: v }),
      setEmail: (email) => set({ email }),
      setCardOnFile: (v, last4, brand) =>
        set((s) => ({
          cardOnFile: v,
          cardLast4: last4 ?? null,
          cardBrand: brand ?? null,
          ...(v ? {
            sessions: s.sessions.map((p) =>
              p.id === s.activeSessionId ? { ...p, cardAssigned: true } : p
            ),
          } : {}),
        })),
      setStripeCustomerId: (id) => set({ stripeCustomerId: id }),
      connectService: (id) => {
        set((s) => {
          const active = getActiveSession(s);
          const updated = { ...active, connectedServices: { ...active.connectedServices, [id]: true } };
          return { sessions: replaceActiveSession(s, updated) };
        });
        const msg = buildConnectionMessage(id);
        if (msg) {
          set((s) => {
            const active = getActiveSession(s);
            const updated = { ...active, messages: [...active.messages, msg] };
            return { sessions: replaceActiveSession(s, updated) };
          });
        }
      },
      disconnectService: (id) =>
        set((s) => {
          const active = getActiveSession(s);
          const updated = { ...active, connectedServices: { ...active.connectedServices, [id]: false } };
          return { sessions: replaceActiveSession(s, updated) };
        }),

      fetchConnectionStatus: async () => {
        const workspaceId = get().activeSessionId;
        if (!workspaceId) return;
        set({ connectionsLoading: true });
        try {
          const res = await fetch(apiUrl(`/api/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`));
          if (res.ok) {
            const serverStatus = await res.json() as Record<string, boolean>;
            set((s) => {
              const active = getActiveSession(s);
              // Merge: server is source of truth, but keep local true values
              // until the server explicitly says otherwise
              const merged: Record<string, boolean> = { ...active.connectedServices };
              for (const [key, val] of Object.entries(serverStatus)) {
                merged[key] = val;
              }
              const updated = { ...active, connectedServices: merged };
              return { sessions: replaceActiveSession(s, updated) };
            });
          }
        } catch {
          // Silently fail — local state remains
        } finally {
          set({ connectionsLoading: false });
        }
      },

      disconnectServiceRemote: async (id) => {
        const workspaceId = get().activeSessionId;
        if (!workspaceId) return;
        set((s) => {
          const active = getActiveSession(s);
          const updated = { ...active, connectedServices: { ...active.connectedServices, [id]: false } };
          return { sessions: replaceActiveSession(s, updated) };
        });
        try {
          await fetch(apiUrl(`/api/oauth/${id}/disconnect`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          });
        } catch {
          // Silently fail
        }
      },

      submitApiKey: async (provider, apiKey, metadata) => {
        const workspaceId = get().activeSessionId;
        if (!workspaceId) return { ok: false, error: "Not authenticated" };
        try {
          const res = await fetch(apiUrl("/api/oauth/api-key"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, workspaceId, apiKey, metadata: metadata ?? null }),
          });
          if (res.ok) {
            set((s) => {
              const active = getActiveSession(s);
              const updated = { ...active, connectedServices: { ...active.connectedServices, [provider]: true } };
              return { sessions: replaceActiveSession(s, updated) };
            });
            const msg = buildConnectionMessage(provider);
            if (msg) {
              set((s) => {
                const active = getActiveSession(s);
                const updated = { ...active, messages: [...active.messages, msg] };
                return { sessions: replaceActiveSession(s, updated) };
              });
            }
            return { ok: true };
          }
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: body.error ?? `Server error (${res.status})` };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Network error" };
        }
      },

      logout: async () => {
        // Flush unsaved messages to server BEFORE clearing state.
        // Fire all syncs in parallel (not sequential) to avoid N×latency.
        const currentSessions = get().sessions;

        // Skip subtrack threads — they are local-only forks
        const wsSubtrackIds = new Set(
          useWorkspaceStore.getState().tracks
            .filter((p) => p.isSubtrack)
            .map((p) => p.id)
        );

        const syncPromises = currentSessions
          .filter((sess) => sess.messages.length > 0 && !wsSubtrackIds.has(sess.id))
          .map((sess) => {
            const sessionMeta = {
              id: sess.id,
              name: sess.name,
              totalCost: sess.totalCost,
              todayCost: sess.todayCost,
              todayTokensIn: sess.todayTokensIn,
              todayTokensOut: sess.todayTokensOut,
              todayMessageCount: sess.todayMessageCount,
              todayDate: sess.todayDate,
              weekCost: sess.weekCost ?? 0,
              weekKey: sess.weekKey,
              monthCost: sess.monthCost ?? 0,
              monthKey: sess.monthKey,
            };

            return fetch(apiUrl("/api/sessions"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session: sessionMeta,
                messages: sess.messages,
              }),
            }).catch(() => {
              // Fetch failed — fall back to sendBeacon with size safety
              if (typeof navigator !== "undefined" && navigator.sendBeacon) {
                const MAX_BEACON_BYTES = 60_000;
                const recentMessages = sess.messages.slice(-50);
                const payload = JSON.stringify({ session: sessionMeta, messages: recentMessages });
                const blob = new Blob([payload], { type: "application/json" });
                if (blob.size < MAX_BEACON_BYTES) {
                  navigator.sendBeacon("/api/sessions", blob);
                } else {
                  const metaOnly = JSON.stringify({ session: sessionMeta, messages: [] });
                  navigator.sendBeacon("/api/sessions", new Blob([metaOnly], { type: "application/json" }));
                }
              }
            });
          });

        // Wait for all syncs in parallel — timeout after 3s so logout isn't blocked
        await Promise.race([
          Promise.allSettled(syncPromises),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);

        // Fire-and-forget server-side session cleanup
        fetch(apiUrl("/api/auth/logout"), { method: "POST" }).catch(() => {});

        // Clear this store immediately — sendBeacon is queued and will complete
        set({
          userId: null,
          handle: null,
          email: null,
          authenticated: false,
          sessionsLoaded: false,
          cardOnFile: false,
          cardLast4: null,
          cardBrand: null,
          stripeCustomerId: null,
          sessions: initialSessions,
          activeSessionId: "default",
          inspectorOpen: false,
          pendingCharges: [],
          isSettling: false,
          cards: [],
          settlementHistory: [],
          spendLimits: { dailyLimit: null, monthlyLimit: null, perTxnLimit: null },
        });

        // Clear workspace store
        useWorkspaceStore.setState({
          workspaces: [],
          tracks: [],
          activeWorkspaceId: null,
          activeTrackId: null,
        });

        // Clear decisions store
        useDecisionsStore.setState({
          decisions: [],
          panelOpen: false,
          filter: "all",
        });

        // Clear staging store
        useStagingStore.getState().clearStaged();

        // Remove persisted localStorage for other stores + drafts
        if (typeof window !== "undefined") {
          localStorage.removeItem("workspace-store-v1");
          localStorage.removeItem("decisions-store-v1");
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("meter:draft:")) keysToRemove.push(key);
          }
          keysToRemove.forEach((k) => localStorage.removeItem(k));
        }
      },

      addSession: (name, idOverride) =>
        set((s) => {
          const cleanName = name.trim();
          if (!cleanName) return s;
          const id = idOverride ?? cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          if (s.sessions.some((p) => p.id === id)) return s;
          return { sessions: [...s.sessions, createSession(id, cleanName)] };
        }),

      renameSession: (sessionId, newName) =>
        set((s) => ({
          sessions: s.sessions.map((p) =>
            p.id === sessionId ? { ...p, name: newName } : p
          ),
        })),

      togglePinMessage: (messageId) =>
        set((s) => ({
          sessions: s.sessions.map((p) =>
            p.id === s.activeSessionId
              ? {
                  ...p,
                  messages: p.messages.map((m) =>
                    m.id === messageId ? { ...m, pinned: !m.pinned } : m
                  ),
                }
              : p
          ),
        })),

      removeSession: (id) =>
        set((s) => {
          const remaining = s.sessions.filter((p) => p.id !== id);
          const nextActiveId =
            s.activeSessionId === id
              ? remaining[0]?.id ?? "default"
              : s.activeSessionId;
          return { sessions: remaining, activeSessionId: nextActiveId };
        }),

      setActiveSession: (id) => {
        set((s) => {
          if (!s.sessions.some((p) => p.id === id)) return s;
          const sessions = s.sessions.map((p) => (p.id === id ? ensureDaily(p) : p));
          return { sessions, activeSessionId: id };
        });
        // Re-fetch connection status for the newly active workspace
        get().fetchConnectionStatus();
      },

      setCardAssigned: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((p) =>
            p.id === sessionId ? { ...p, cardAssigned: true } : p
          ),
        })),

      addMessage: (msg, forSessionId?) =>
        set((s) => {
          const active = ensureDaily(getSessionByIdOrActive(s, forSessionId));
          const updated = { ...active, messages: [...active.messages, msg] };
          return { sessions: replaceActiveSession(s, updated) };
        }),

      updateLastAssistantMessage: (content, tokensOut, forSessionId?) =>
        set((s) => {
          const active = ensureDaily(getSessionByIdOrActive(s, forSessionId));
          const pricingModelId = s.selectedModelId === "auto" ? "openai/gpt-5.4" : s.selectedModelId;
          const model = getModel(pricingModelId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, content, tokensOut, receiptStatus: "signing" };
          }

          const prevOut = last?.tokensOut || 0;
          const deltaOut = Math.max(0, tokensOut - prevOut);
          const costDelta = deltaOut * model.outputPrice * s.markupMultiplier;

          const updated = {
            ...active,
            messages: msgs,
            todayTokensOut: active.todayTokensOut + deltaOut,
            todayCost: active.todayCost + costDelta,
            weekCost: (active.weekCost ?? 0) + costDelta,
            monthCost: (active.monthCost ?? 0) + costDelta,
            totalCost: active.totalCost + costDelta,
            currentMessageCost: active.currentMessageCost + costDelta,
          };

          return { sessions: replaceActiveSession(s, updated) };
        }),

      updateLastAssistantThinking: (thinking, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, thinking };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      finalizeResponse: (tokensIn, tokensOut, confidence, actualModel, cacheCreationTokens, cacheReadTokens, cacheReadRate, actualCost, forSessionId?) => {
        set((s) => {
          const active = ensureDaily(getSessionByIdOrActive(s, forSessionId));
          const pricingModelId = actualModel
            ?? (s.selectedModelId === "auto" ? "openai/gpt-5.4" : s.selectedModelId);
          const model = getModel(pricingModelId);

          // When the server sends a pre-computed actualCost (e.g. debate mode
          // which calls multiple models at different rates), use it directly.
          // Otherwise compute from tokens × model rate with cache awareness.
          // Account-level markup is applied to the final cost.
          const markup = s.markupMultiplier;
          let totalMsgCost: number;
          if (actualCost != null && actualCost > 0) {
            totalMsgCost = actualCost * markup;
          } else {
            // Cache-aware input cost: providers charge different rates for
            // cached vs uncached input tokens.
            //   - Uncached: standard inputPrice
            //   - Cache creation: 1.25x inputPrice (one-time write, Anthropic only)
            //   - Cache read: rate * inputPrice (Anthropic/Gemini/DeepSeek=0.1x, OpenAI=0.5x)
            // When no cache breakdown is provided (OpenRouter),
            // fall back to flat inputPrice for all tokens.
            const cacheWrite = cacheCreationTokens ?? 0;
            const cacheHit = cacheReadTokens ?? 0;
            const readRate = cacheReadRate || 0.1; // default to Anthropic rate
            const uncachedIn = tokensIn - cacheWrite - cacheHit;
            const inputCost = cacheWrite > 0 || cacheHit > 0
              ? (uncachedIn * model.inputPrice) +
                (cacheWrite * model.inputPrice * 1.25) +
                (cacheHit * model.inputPrice * readRate)
              : tokensIn * model.inputPrice;
            totalMsgCost = (inputCost + tokensOut * model.outputPrice) * markup;
          }

          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = {
              ...last,
              tokensIn,
              tokensOut,
              cost: totalMsgCost,
              confidence,
              model: pricingModelId,
              settled: false,
              receiptStatus: "signed",
              signature: `0x${shortHex()}${shortHex()}${shortHex()}`,
            };
          }

          const byModel = { ...active.todayByModel };
          const modelKey = model.name;
          const existing = byModel[modelKey] || { cost: 0, count: 0 };
          byModel[modelKey] = {
            cost: existing.cost + totalMsgCost,
            count: existing.count + 1,
          };

          // Snap to ground truth: during streaming (and debate turns),
          // costs are estimated incrementally via char/4 heuristics and may
          // use different model pricing.  Rather than trying to reverse-
          // engineer what was accumulated, compute the exact adjustment
          // needed so every counter matches the API-reported actuals.
          // This eliminates debate-mode double-counting and rerouting drift.
          const prevMessageCost = active.currentMessageCost;
          const costAdjustment = totalMsgCost - prevMessageCost;

          // Same for output tokens: streaming used char/4 estimates.
          const streamedEstimateOut = last?.tokensOut ?? 0;
          const tokensOutAdjustment = tokensOut - streamedEstimateOut;

          const updated = {
            ...active,
            messages: msgs,
            todayTokensIn: active.todayTokensIn + tokensIn,
            todayTokensOut: Math.max(0, active.todayTokensOut + tokensOutAdjustment),
            todayMessageCount: active.todayMessageCount + 1,
            todayByModel: byModel,
            todayCost: active.todayCost + costAdjustment,
            weekCost: (active.weekCost ?? 0) + costAdjustment,
            monthCost: (active.monthCost ?? 0) + costAdjustment,
            totalCost: active.totalCost + costAdjustment,
            currentMessageCost: totalMsgCost,
            // Keep server aggregate counters in sync with new messages
            serverTokensIn: active.serverTokensIn + tokensIn,
            serverTokensOut: Math.max(0, active.serverTokensOut + tokensOutAdjustment),
            serverMessageCount: active.serverMessageCount + 1,
            serverPendingBalance: (active.serverPendingBalance ?? 0) + totalMsgCost,
          };

          return { sessions: replaceActiveSession(s, updated) };
        });
      },

      markSettled: (messageId) =>
        set((s) => {
          const active = getActiveSession(s);
          const updated = {
            ...active,
            messages: active.messages.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    settled: true,
                    receiptStatus: "settled" as const,
                    txHash: `0x${shortHex()}${shortHex()}${shortHex()}${shortHex()}`,
                  }
                : m
            ),
          };
          return { sessions: replaceActiveSession(s, updated) };
        }),

      getPendingBalance: () => {
        const s = get();
        const active = getWorkspaceSession(s);
        if (!active) return 0;
        // Use server-computed pending balance (covers ALL messages, not just loaded 200).
        // Fall back to loaded-messages sum for local-only sessions.
        const loadedMsgCost = active.messages
          .filter((m) => m.role === "assistant" && m.cost !== undefined && !m.settled)
          .reduce((sum, m) => sum + (m.cost ?? 0), 0);
        const msgCost = Math.max(active.serverPendingBalance ?? 0, loadedMsgCost);
        const cardCost = s.pendingCharges
          .filter((c) => c.workspaceId === active.id)
          .reduce((sum, c) => sum + c.cost, 0);
        return msgCost + cardCost;
      },

      getUnsettledMessages: () => {
        const s = get();
        const active = getWorkspaceSession(s);
        if (!active) return [];
        return active.messages
          .filter((m) => m.role === "assistant" && m.cost !== undefined && !m.settled);
      },

      settleAll: async () => {
        const s = get();
        if (s.isSettling) return { success: false, error: "Already settling" };
        set((prev) => {
          const active = getWorkspaceSession(prev);
          if (!active) return { isSettling: true };
          return {
            isSettling: true,
            sessions: replaceActiveSession(prev, { ...active, settlementError: null }),
          };
        });

        const active = getWorkspaceSession(s);
        if (!active) {
          set({ isSettling: false });
          return { success: false, error: "No active workspace" };
        }

        const unsettledMsgs = active.messages
          .filter((m) => m.role === "assistant" && m.cost !== undefined && !m.settled);
        const messageIds = unsettledMsgs.map((m) => m.id);
        const chargeIds = s.pendingCharges
          .filter((c) => c.workspaceId === active.id)
          .map((c) => c.id);
        const amount = s.getPendingBalance();

        if (amount <= 0) {
          set({ isSettling: false });
          return { success: false, error: "No balance to settle" };
        }

        try {
          const res = await fetch(apiUrl("/api/billing/settle"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stripeCustomerId: s.stripeCustomerId,
              workspaceId: active.id,
              amount,
              messageIds,
              chargeIds,
            }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: "Settlement failed" }));
            const errorMsg = body.error ?? "Settlement failed";
            set((prev) => {
              const current = prev.sessions.find((p) => p.id === active.id);
              if (!current) return { isSettling: false };
              return {
                isSettling: false,
                sessions: prev.sessions.map((p) => p.id === active.id ? {
                  ...current,
                  settlementError: errorMsg,
                  chatBlocked: true,
                } : p),
              };
            });
            return { success: false, error: errorMsg };
          }

          const data = await res.json();
          const batchTxHash = data.txHash as string | undefined;

          set((prev) => {
            const current = prev.sessions.find((p) => p.id === active.id);
            if (!current) return { isSettling: false };
            const updatedSession = {
              ...current,
              messages: current.messages.map((m) =>
                messageIds.includes(m.id)
                  ? {
                      ...m,
                      settled: true,
                      receiptStatus: "settled" as const,
                      txHash: batchTxHash ?? `0x${shortHex()}${shortHex()}${shortHex()}${shortHex()}`,
                    }
                  : m
              ),
              settlementError: null,
              chatBlocked: false,
            };
            const remainingCharges = prev.pendingCharges.filter((c) => c.workspaceId !== active.id);
            return {
              sessions: prev.sessions.map((p) => p.id === active.id ? updatedSession : p),
              pendingCharges: remainingCharges,
              isSettling: false,
            };
          });
          return { success: true };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Settlement failed";
          set((prev) => {
            const current = prev.sessions.find((p) => p.id === active.id);
            if (!current) return { isSettling: false };
            return {
              isSettling: false,
              sessions: prev.sessions.map((p) => p.id === active.id ? {
                ...current,
                settlementError: errorMsg,
                chatBlocked: true,
              } : p),
            };
          });
          return { success: false, error: errorMsg };
        }
      },

      approveCard: (messageId, cardId) => {
        set((s) => {
          const active = getActiveSession(s);
          if (!active) return s;
          const updated = {
            ...active,
            messages: active.messages.map((m) => {
              if (m.id !== messageId) return m;
              const cards = m.cards?.map((c) =>
                c.id === cardId ? { ...c, status: "approved" as const } : c
              );
              return { ...m, cards };
            }),
          };
          const card = active.messages.find((m) => m.id === messageId)?.cards?.find((c) => c.id === cardId);
          const newCharge =
            card && card.cost
              ? [...s.pendingCharges, { id: card.id, title: card.title, cost: card.cost, type: "card" as const, workspaceId: active.id, paidAt: Date.now() }]
              : s.pendingCharges;
          return { sessions: replaceActiveSession(s, updated), pendingCharges: newCharge };
        });
      },

      rejectCard: (messageId, cardId) =>
        set((s) => {
          const active = getActiveSession(s);
          const updated = {
            ...active,
            messages: active.messages.map((m) => {
              if (m.id !== messageId) return m;
              const cards = m.cards?.map((c) =>
                c.id === cardId ? { ...c, status: "rejected" as const } : c
              );
              return { ...m, cards };
            }),
          };
          return { sessions: replaceActiveSession(s, updated) };
        }),

      addCardToLastMessage: (card, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = {
              ...last,
              cards: [...(last.cards ?? []), card],
            };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      purchaseDomain: async (messageId, cardId) => {
        const s = get();
        const active = getActiveSession(s);
        const msg = active.messages.find((m) => m.id === messageId);
        const card = msg?.cards?.find((c) => c.id === cardId);
        if (!card || !card.metadata?.domain) {
          return { success: false, error: "Card not found" };
        }

        // Check per-transaction spend limit
        const cost = card.cost ?? 0;
        const limits = s.spendLimits;
        if (limits.perTxnLimit && cost > limits.perTxnLimit) {
          return { success: false, error: `Purchase ($${cost.toFixed(2)}) exceeds per-transaction limit ($${limits.perTxnLimit.toFixed(2)})` };
        }
        if (limits.dailyLimit && (active.todayCost + cost) > limits.dailyLimit) {
          return { success: false, error: `Purchase would exceed daily limit ($${limits.dailyLimit.toFixed(2)})` };
        }

        // Set card to purchasing state
        set((prev) => {
          const proj = getActiveSession(prev);
          const updated = {
            ...proj,
            messages: proj.messages.map((m) => {
              if (m.id !== messageId) return m;
              return {
                ...m,
                cards: m.cards?.map((c) =>
                  c.id === cardId ? { ...c, status: "approved" as const } : c
                ),
              };
            }),
          };
          return { sessions: replaceActiveSession(prev, updated) };
        });

        try {
          const res = await fetch(apiUrl("/api/porkbun/register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain: card.metadata.domain }),
          });
          const data = await res.json();
          if (!res.ok) {
            // Revert card status on failure
            set((prev) => {
              const proj = getActiveSession(prev);
              const updated = {
                ...proj,
                messages: proj.messages.map((m) => {
                  if (m.id !== messageId) return m;
                  return {
                    ...m,
                    cards: m.cards?.map((c) =>
                      c.id === cardId ? { ...c, status: "pending" as const } : c
                    ),
                  };
                }),
              };
              return { sessions: replaceActiveSession(prev, updated) };
            });
            return { success: false, error: data.error ?? "Registration failed" };
          }

          // Success: add to pending charges and update today cost
          const purchaseCost = data.price ?? cost;
          set((prev) => ({
            pendingCharges: [
              ...prev.pendingCharges,
              {
                id: card.id,
                title: card.metadata!.domain,
                cost: purchaseCost,
                type: "card" as const,
                workspaceId: active.id,
                paidAt: Date.now(),
              },
            ],
          }));

          // Increment today cost
          set((prev) => {
            const proj = getActiveSession(prev);
            return {
              sessions: replaceActiveSession(prev, {
                ...proj,
                todayCost: proj.todayCost + purchaseCost,
                weekCost: (proj.weekCost ?? 0) + purchaseCost,
                monthCost: (proj.monthCost ?? 0) + purchaseCost,
                totalCost: proj.totalCost + purchaseCost,
              }),
            };
          });

          return { success: true };
        } catch {
          // Revert card status on error
          set((prev) => {
            const proj = getActiveSession(prev);
            const updated = {
              ...proj,
              messages: proj.messages.map((m) => {
                if (m.id !== messageId) return m;
                return {
                  ...m,
                  cards: m.cards?.map((c) =>
                    c.id === cardId ? { ...c, status: "pending" as const } : c
                  ),
                };
              }),
            };
            return { sessions: replaceActiveSession(prev, updated) };
          });
          return { success: false, error: "Network error — try again" };
        }
      },

      setMessageDecisionId: (decisionId, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, decisionId };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      addDocumentToLastMessage: (doc, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            const existing = last.documents ?? [];
            msgs[msgs.length - 1] = { ...last, documents: [...existing, doc] };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      markDocumentSaved: (messageId, docId) =>
        set((s) => {
          const active = getActiveSession(s);
          if (!active) return s;
          const msgs = active.messages.map((m) => {
            if (m.id !== messageId || !m.documents) return m;
            return {
              ...m,
              documents: m.documents.map((d) =>
                d.id === docId ? { ...d, saved: true } : d
              ),
            };
          });
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      setDebateTrace: (trace, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, debateTrace: trace };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      addClarifyingQuestions: (questions, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, clarifyingQuestions: questions };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      updateClarifyingAnswer: (messageId, questionId, answer) =>
        set((s) => {
          const active = getActiveSession(s);
          if (!active) return s;
          const msgs = active.messages.map((m) => {
            if (m.id !== messageId || !m.clarifyingQuestions) return m;
            return {
              ...m,
              clarifyingQuestions: m.clarifyingQuestions.map((q) =>
                q.id === questionId ? { ...q, answer } : q
              ),
            };
          });
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      setDissectorTrace: (trace, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, dissectorTrace: trace };
          }
          return { sessions: replaceActiveSession(s, { ...active, messages: msgs }) };
        }),

      setStreaming: (v, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const updated = {
            ...active,
            isStreaming: v,
            ...(v ? { currentMessageCost: 0 } : {}),
          };
          return { sessions: replaceActiveSession(s, updated) };
        }),

      clearSettlementError: () =>
        set((s) => {
          const active = getActiveSession(s);
          if (!active) return s;
          return {
            sessions: replaceActiveSession(s, { ...active, settlementError: null }),
          };
        }),

      fetchCards: async () => {
        set({ cardsLoading: true });
        try {
          const res = await fetch(apiUrl("/api/billing/cards"));
          if (res.ok) {
            const data = await res.json();
            set({ cards: data.cards ?? [] });
          }
        } catch { /* silent */ } finally {
          set({ cardsLoading: false });
        }
      },

      setDefaultCard: async (paymentMethodId) => {
        try {
          const res = await fetch(apiUrl("/api/billing/cards/default"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethodId }),
          });
          if (res.ok) {
            const data = await res.json();
            set((s) => ({
              cards: s.cards.map((c) => ({ ...c, isDefault: c.id === paymentMethodId })),
              cardLast4: data.cardLast4,
              cardBrand: data.cardBrand,
            }));
          }
        } catch { /* silent */ }
      },

      removeCard: async (paymentMethodId) => {
        try {
          const res = await fetch(apiUrl(`/api/billing/cards/${paymentMethodId}`), {
            method: "DELETE",
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: "Failed to remove card" }));
            return { success: false, error: body.error };
          }
          set((s) => ({ cards: s.cards.filter((c) => c.id !== paymentMethodId) }));
          await get().fetchCards();
          return { success: true };
        } catch {
          return { success: false, error: "Failed to remove card" };
        }
      },

      fetchSettlementHistory: async (workspaceId) => {
        const sessionId = workspaceId ?? get().activeSessionId;
        if (!sessionId) return;
        set({ settlementHistoryLoading: true });
        try {
          const res = await fetch(apiUrl(`/api/billing/history?workspaceId=${encodeURIComponent(sessionId)}`));
          if (res.ok) {
            const data = await res.json();
            set({ settlementHistory: data.history ?? [] });
          }
        } catch { /* silent */ } finally {
          set({ settlementHistoryLoading: false });
        }
      },

      fetchSpendLimits: async (workspaceId) => {
        const sessionId = resolveWorkspaceSessionId(workspaceId ?? get().activeSessionId);
        if (!sessionId) return;
        try {
          const res = await fetch(apiUrl(`/api/billing/spend-limits?workspaceId=${encodeURIComponent(sessionId)}`));
          if (res.ok) {
            const data = await res.json();
            set({ spendLimits: { dailyLimit: data.dailyLimit ?? null, monthlyLimit: data.monthlyLimit ?? null, perTxnLimit: data.perTxnLimit ?? null } });
          }
        } catch { /* silent */ }
      },

      updateSpendLimits: async (limits, workspaceId) => {
        const sessionId = resolveWorkspaceSessionId(workspaceId ?? get().activeSessionId);
        if (!sessionId) return;
        const merged = { ...get().spendLimits, ...limits };
        set({ spendLimits: merged });
        try {
          await fetch(apiUrl("/api/billing/spend-limits"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId: sessionId, ...merged }),
          });
        } catch { /* silent */ }
      },

      resetDailyIfNeeded: () =>
        set((s) => {
          let changed = false;
          const sessions = s.sessions.map((p) => {
            const next = ensureDaily(p);
            if (next !== p) changed = true;
            return next;
          });
          return changed ? { sessions } : {};
        }),

      attemptDailySettlement: async () => {
        const today = todayStr();
        const state = get();
        if (state.lastAutoSettleDate === today) return;
        if (state.accountType === "superadmin") return; // superadmin never auto-settles
        set({ lastAutoSettleDate: today });

        const balance = state.getPendingBalance();
        if (balance >= state.autoSettleThreshold) {
          await state.settleAll();
        }
      },

      setPendingInput: (v) => set({ pendingInput: v }),

      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      setInspectorOpen: (v) => set({ inspectorOpen: v }),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setScrollToMessageId: (id) => set({ scrollToMessageId: id }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setDebateMode: (on) => set({ debateMode: on }),
      toggleDebateMode: () => set((s) => {
        if (s.debateMode) {
          // Turning off debate — clear roster
          return { debateMode: false, debateRoster: [] };
        }
        // Turning on debate — if roster has <2 models, populate with defaults
        const roster = s.debateRoster.length >= 2
          ? s.debateRoster
          : ["anthropic/claude-opus-4.6", "openai/gpt-5.4", "x-ai/grok-4.1-fast"];
        return { debateMode: true, debateRoster: roster };
      }),
      setDebateRoster: (models) => set({ debateRoster: models, debateMode: models.length >= 2 }),
      toggleDebateRosterModel: (modelId) => set((s) => {
        const has = s.debateRoster.includes(modelId);
        const next = has
          ? s.debateRoster.filter((id) => id !== modelId)
          : [...s.debateRoster, modelId];
        // When roster drops to 1, exit debate and select the remaining model
        if (next.length === 1) {
          return { debateRoster: next, debateMode: false, selectedModelId: next[0] };
        }
        return { debateRoster: next, debateMode: next.length >= 2 };
      }),
      setSpendingCapEnabled: (v) => set({ spendingCapEnabled: v }),
      setSpendingCap: (v) => set({ spendingCap: v }),
      setAutoSettleThreshold: (v) => set({ autoSettleThreshold: v }),
      setIsSettling: (v) => set({ isSettling: v }),
      incrementCurrentMessageCost: (costDelta, forSessionId?) =>
        set((s) => {
          const active = ensureDaily(getSessionByIdOrActive(s, forSessionId));
          const scaled = costDelta * s.markupMultiplier;
          return {
            sessions: replaceActiveSession(s, {
              ...active,
              currentMessageCost: active.currentMessageCost + scaled,
              todayCost: active.todayCost + scaled,
              weekCost: (active.weekCost ?? 0) + scaled,
              monthCost: (active.monthCost ?? 0) + scaled,
              totalCost: active.totalCost + scaled,
            }),
          };
        }),
      setDecisionMode: (v) => set({ decisionMode: v }),

      // Pagination: prepend older messages loaded via scroll
      prependMessages: (sessionId, messages, hasMore) =>
        set((s) => {
          const sessions = s.sessions.map((p) => {
            if (p.id !== sessionId) return p;
            // Deduplicate by ID
            const existingIds = new Set(p.messages.map((m) => m.id));
            const newMsgs = messages.filter((m) => !existingIds.has(m.id));
            const merged = [...newMsgs, ...p.messages];
            const oldest = merged.length > 0 ? merged[0].timestamp : null;
            return {
              ...p,
              messages: merged,
              hasOlderMessages: hasMore,
              loadingOlderMessages: false,
              oldestLoadedTimestamp: oldest,
            };
          });
          return { sessions };
        }),

      fetchOlderMessages: async (sessionId) => {
        const state = get();
        const sess = state.sessions.find((p) => p.id === sessionId);
        if (!sess || sess.loadingOlderMessages || !sess.hasOlderMessages) return;

        // Mark loading
        set((s) => ({
          sessions: s.sessions.map((p) =>
            p.id === sessionId ? { ...p, loadingOlderMessages: true } : p,
          ),
        }));

        try {
          const oldest = sess.messages[0];
          const params = new URLSearchParams({ limit: "200" });
          if (oldest) {
            params.set("before", String(oldest.timestamp));
            params.set("before_id", oldest.id);
          }

          const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const mapped: ChatMessage[] = (data.messages ?? []).map((m: Record<string, unknown>) => ({
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
            debateTrace: m.debate_trace as DebateTurn[] | undefined,
            documents: m.documents as DocumentPreview[] | undefined,
            thinking: m.thinking as string | undefined,
            timestamp: m.timestamp as number,
          }));

          get().prependMessages(sessionId, mapped, data.hasMore ?? false);
        } catch (err) {
          console.warn("[meter] Failed to fetch older messages:", err);
          // Clear loading state on error
          set((s) => ({
            sessions: s.sessions.map((p) =>
              p.id === sessionId ? { ...p, loadingOlderMessages: false } : p,
            ),
          }));
        }
      },

      // --- Branching actions ---

      createSubtrackSession: (subtrackId: string, parentSessionId: string, forkMessageId: string) => {
        set((s) => {
          const existing = s.sessions.find((p) => p.id === subtrackId);
          // If subtrack already has messages, skip (idempotent)
          if (existing && existing.messages.length > 0) return s;

          const parent = s.sessions.find((p) => p.id === parentSessionId);
          if (!parent) return s;
          // Find all messages up to and including the fork message
          const forkIdx = parent.messages.findIndex((m) => m.id === forkMessageId);
          if (forkIdx === -1) return s;
          const sharedMessages = parent.messages.slice(0, forkIdx + 1).map((m) => ({ ...m }));
          // Mark the fork point on the parent thread
          const updatedParent = {
            ...parent,
            messages: parent.messages.map((m) =>
              m.id === forkMessageId ? { ...m, isForkPoint: true } : m
            ),
          };

          // If thread shell exists (e.g. from localStorage after refresh), update in place
          if (existing) {
            return {
              sessions: s.sessions.map((p) => {
                if (p.id === parentSessionId) return updatedParent;
                if (p.id === subtrackId) return { ...p, messages: sharedMessages, connectedServices: { ...parent.connectedServices }, cardAssigned: parent.cardAssigned };
                return p;
              }),
            };
          }

          // Create new subtrack thread with cloned messages
          const subtrackThread = createSession(subtrackId, subtrackId);
          subtrackThread.messages = sharedMessages;
          // Copy connected services from parent
          subtrackThread.connectedServices = { ...parent.connectedServices };
          subtrackThread.cardAssigned = parent.cardAssigned;
          return {
            sessions: s.sessions.map((p) => (p.id === parentSessionId ? updatedParent : p)).concat(subtrackThread),
          };
        });
      },

      mergeSubtrackIntoParent: (subtrackId: string, parentSessionId: string, forkMessageId: string) => {
        set((s) => {
          const subtrack = s.sessions.find((p) => p.id === subtrackId);
          const parent = s.sessions.find((p) => p.id === parentSessionId);
          if (!subtrack || !parent) return s;
          // Get subtrack-only messages (those after the fork point)
          const forkIdx = subtrack.messages.findIndex((m) => m.id === forkMessageId);
          const newMessages = forkIdx === -1 ? [] : subtrack.messages.slice(forkIdx + 1);
          // Mark the last merged message so we can render an end-of-merge divider
          if (newMessages.length > 0) {
            newMessages[newMessages.length - 1] = { ...newMessages[newMessages.length - 1], isMergeEnd: true };
          }
          // Append to parent and mark fork as merged (keep divider permanently)
          const updatedParent = {
            ...parent,
            messages: [
              ...parent.messages.map((m) =>
                m.id === forkMessageId ? { ...m, isForkPoint: true, forkResolution: "merged" as const } : m
              ),
              ...newMessages,
            ],
          };
          // Remove the subtrack thread
          const sessions = s.sessions
            .filter((p) => p.id !== subtrackId)
            .map((p) => (p.id === parentSessionId ? updatedParent : p));
          return { sessions };
        });
      },

      clearForkPoint: (parentSessionId: string, forkMessageId: string) => {
        set((s) => ({
          sessions: s.sessions.map((p) => {
            if (p.id !== parentSessionId) return p;
            return {
              ...p,
              messages: p.messages.map((m) =>
                m.id === forkMessageId ? { ...m, isForkPoint: true, forkResolution: "closed" as const } : m
              ),
            };
          }),
        }));
      },

      reset: () =>
        set((s) => ({
          sessions: s.sessions.map((p) => ({
            ...p,
            messages: [],
            isStreaming: false,
            settlementError: null,
            chatBlocked: false,
          })),
          pendingCharges: [],
          isSettling: false,
        })),
    }),
    {
      name: "meter-store-v3",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Migrate old localStorage shape (projects/activeProjectId) → new (sessions/activeSessionId)
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          if (state.projects && !state.sessions) {
            state.sessions = state.projects;
            delete state.projects;
          }
          if (state.activeProjectId !== undefined && state.activeSessionId === undefined) {
            state.activeSessionId = state.activeProjectId;
            delete state.activeProjectId;
          }
        }
        return state as MeterState;
      },
      partialize: (s) => ({
        userId: s.userId,
        email: s.email,
        handle: s.handle,
        accountType: s.accountType,
        markupMultiplier: s.markupMultiplier,
        authenticated: s.authenticated,
        cardOnFile: s.cardOnFile,
        cardLast4: s.cardLast4,
        cardBrand: s.cardBrand,
        stripeCustomerId: s.stripeCustomerId,
        selectedModelId: s.selectedModelId,
        debateMode: s.debateMode,
        debateRoster: s.debateRoster,
        spendingCapEnabled: s.spendingCapEnabled,
        spendingCap: s.spendingCap,
        autoSettleThreshold: s.autoSettleThreshold,
        lastAutoSettleDate: s.lastAutoSettleDate,
        sessions: s.sessions.map((p) => ({ ...p, messages: [] })),
        activeSessionId: s.activeSessionId,
        spendLimits: s.spendLimits,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = new Date();
        const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now);
        mon.setDate(now.getDate() + diff);
        mon.setHours(0, 0, 0, 0);
        const curWeek = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
        const weekStart = mon.getTime();

        state.sessions = state.sessions.map((p) => {
          let proj = p.isStreaming ? { ...p, isStreaming: false } : p;

          // Seed monthKey/weekKey if missing (old-format migration).
          // Messages are no longer in localStorage, so cost values come from
          // persisted session fields — just stamp the period keys.
          if (proj.monthKey == null) {
            proj = { ...proj, monthCost: Math.max(proj.monthCost ?? 0, proj.todayCost ?? 0), monthKey: curMonth };
          }
          if (proj.weekKey == null) {
            proj = { ...proj, weekCost: Math.max(proj.weekCost ?? 0, proj.todayCost ?? 0), weekKey: curWeek };
          }

          return proj;
        });
      },
    }
  )
);

/** Selector: connectedServices for the active workspace */
export const selectConnectedServices = (s: MeterState) => {
  const active = s.sessions.find((p) => p.id === s.activeSessionId);
  return active?.connectedServices ?? {};
};

/** Selector: whether the active workspace has card access */
export const selectWorkspaceCardReady = (s: MeterState): boolean => {
  const active = s.sessions.find((p) => p.id === s.activeSessionId);
  if (!active) return s.cardOnFile;
  if (active.cardAssigned === undefined) return s.cardOnFile;
  return active.cardAssigned;
};
