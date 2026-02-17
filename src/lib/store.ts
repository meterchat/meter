import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL, getModel } from "@/lib/models";

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
}

interface ProjectThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  todayCost: number;
  todayTokensIn: number;
  todayTokensOut: number;
  todayMessageCount: number;
  todayByModel: Record<string, { cost: number; count: number }>;
  todayDate: string;
  totalCost: number;
}

interface MeterState {
  userId: string | null;
  email: string | null;
  authenticated: boolean;
  cardOnFile: boolean;

  selectedModelId: string;
  spendingCapEnabled: boolean;
  spendingCap: number;

  projects: ProjectThread[];
  activeProjectId: string;

  pendingCharges: { id: string; title: string; cost: number }[];

  inspectorOpen: boolean;
  inspectorTab: string;

  setAuth: (userId: string, email: string) => void;
  setCardOnFile: (v: boolean) => void;
  logout: () => void;

  addProject: (name: string) => void;
  setActiveProject: (id: string) => void;

  addMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (content: string, tokensOut: number) => void;
  finalizeResponse: (tokensIn: number, tokensOut: number, confidence: number) => void;
  setStreaming: (v: boolean) => void;
  markSettled: (messageId: string) => void;

  approveCard: (messageId: string, cardId: string) => void;
  rejectCard: (messageId: string, cardId: string) => void;

  toggleInspector: () => void;
  setInspectorOpen: (v: boolean) => void;
  setInspectorTab: (tab: string) => void;

  setSelectedModelId: (id: string) => void;
  setSpendingCapEnabled: (v: boolean) => void;
  setSpendingCap: (v: number) => void;

  reset: () => void;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function createProject(id: string, name: string): ProjectThread {
  return {
    id,
    name,
    messages: [],
    isStreaming: false,
    todayCost: 0,
    todayTokensIn: 0,
    todayTokensOut: 0,
    todayMessageCount: 0,
    todayByModel: {},
    todayDate: todayStr(),
    totalCost: 0,
  };
}

function ensureDaily(project: ProjectThread): ProjectThread {
  const today = todayStr();
  if (project.todayDate === today) return project;
  return {
    ...project,
    todayCost: 0,
    todayTokensIn: 0,
    todayTokensOut: 0,
    todayMessageCount: 0,
    todayByModel: {},
    todayDate: today,
  };
}

function getActiveProject(state: MeterState): ProjectThread {
  return state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
}

function replaceActiveProject(state: MeterState, project: ProjectThread): ProjectThread[] {
  return state.projects.map((p) => (p.id === project.id ? project : p));
}

function shortHex() {
  return Math.random().toString(16).slice(2, 10);
}

const initialProjects = [
  createProject("meter", "Meter"),
  createProject("keypass", "Keypass"),
];

export const useMeterStore = create<MeterState>()(
  persist(
    (set) => ({
      userId: null,
      email: null,
      authenticated: false,
      cardOnFile: false,

      selectedModelId: DEFAULT_MODEL.id,
      spendingCapEnabled: false,
      spendingCap: 10,

      projects: initialProjects,
      activeProjectId: "meter",

      pendingCharges: [],

      inspectorOpen: false,
      inspectorTab: "usage",

      setAuth: (userId, email) => set({ userId, email, authenticated: true }),
      setCardOnFile: (v) => set({ cardOnFile: v }),

      logout: () =>
        set({
          userId: null,
          email: null,
          authenticated: false,
          cardOnFile: false,
          projects: initialProjects,
          activeProjectId: "meter",
          inspectorOpen: false,
          pendingCharges: [],
        }),

      addProject: (name) =>
        set((s) => {
          const cleanName = name.trim();
          if (!cleanName) return s;
          const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          if (s.projects.some((p) => p.id === id)) return s;
          return { projects: [...s.projects, createProject(id, cleanName)] };
        }),

      setActiveProject: (id) =>
        set((s) => {
          if (!s.projects.some((p) => p.id === id)) return s;
          const projects = s.projects.map((p) => (p.id === id ? ensureDaily(p) : p));
          return { projects, activeProjectId: id };
        }),

      addMessage: (msg) =>
        set((s) => {
          const active = ensureDaily(getActiveProject(s));
          const updated = { ...active, messages: [...active.messages, msg] };
          return { projects: replaceActiveProject(s, updated) };
        }),

      updateLastAssistantMessage: (content, tokensOut) =>
        set((s) => {
          const active = ensureDaily(getActiveProject(s));
          const pricingModelId = s.selectedModelId === "auto" ? "anthropic/claude-sonnet-4" : s.selectedModelId;
          const model = getModel(pricingModelId);
          const msgs = [...active.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, content, tokensOut, receiptStatus: "signing" };
          }

          const prevOut = last?.tokensOut || 0;
          const deltaOut = Math.max(0, tokensOut - prevOut);
          const costDelta = deltaOut * model.outputPrice;

          const updated = {
            ...active,
            messages: msgs,
            todayTokensOut: active.todayTokensOut + deltaOut,
            todayCost: active.todayCost + costDelta,
            totalCost: active.totalCost + costDelta,
          };

          return { projects: replaceActiveProject(s, updated) };
        }),

      finalizeResponse: (tokensIn, tokensOut, confidence) =>
        set((s) => {
          const active = ensureDaily(getActiveProject(s));
          const pricingModelId = s.selectedModelId === "auto" ? "anthropic/claude-sonnet-4" : s.selectedModelId;
          const model = getModel(pricingModelId);
          const inputCost = tokensIn * model.inputPrice;
          const totalMsgCost = inputCost + tokensOut * model.outputPrice;

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

          const updated = {
            ...active,
            messages: msgs,
            todayTokensIn: active.todayTokensIn + tokensIn,
            todayMessageCount: active.todayMessageCount + 1,
            todayByModel: byModel,
            todayCost: active.todayCost + inputCost,
            totalCost: active.totalCost + inputCost,
          };

          return { projects: replaceActiveProject(s, updated) };
        }),

      markSettled: (messageId) =>
        set((s) => {
          const active = getActiveProject(s);
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
          return { projects: replaceActiveProject(s, updated) };
        }),

      approveCard: (messageId, cardId) =>
        set((s) => {
          const active = getActiveProject(s);
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
              ? [...s.pendingCharges, { id: card.id, title: card.title, cost: card.cost }]
              : s.pendingCharges;
          return { projects: replaceActiveProject(s, updated), pendingCharges: newCharge };
        }),

      rejectCard: (messageId, cardId) =>
        set((s) => {
          const active = getActiveProject(s);
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
          return { projects: replaceActiveProject(s, updated) };
        }),

      setStreaming: (v) =>
        set((s) => {
          const active = getActiveProject(s);
          const updated = { ...active, isStreaming: v };
          return { projects: replaceActiveProject(s, updated) };
        }),

      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      setInspectorOpen: (v) => set({ inspectorOpen: v }),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setSpendingCapEnabled: (v) => set({ spendingCapEnabled: v }),
      setSpendingCap: (v) => set({ spendingCap: v }),

      reset: () =>
        set((s) => ({
          projects: s.projects.map((p) => ({ ...p, messages: [], isStreaming: false })),
          pendingCharges: [],
        })),
    }),
    {
      name: "meter-store-v3",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        userId: s.userId,
        email: s.email,
        authenticated: s.authenticated,
        cardOnFile: s.cardOnFile,
        selectedModelId: s.selectedModelId,
        spendingCapEnabled: s.spendingCapEnabled,
        spendingCap: s.spendingCap,
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
    }
  )
);
