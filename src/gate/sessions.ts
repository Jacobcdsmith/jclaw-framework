export interface JclawSessionEntry {
  sessionId: string;
  updatedAt: number;
  label?: string;
  channel?: string;
  groupId?: string;
  status: "running" | "done" | "failed";
  model?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  lastChannel?: string;
  lastTo?: string;
}

export interface JclawSessionStore {
  upsert(entry: JclawSessionEntry): void;
  get(sessionId: string): JclawSessionEntry | undefined;
  list(): JclawSessionEntry[];
}

export function initSessionStore(): JclawSessionStore {
  const byId = new Map<string, JclawSessionEntry>();

  return {
    upsert(entry) {
      byId.set(entry.sessionId, { ...entry, updatedAt: Date.now() });
    },
    get(sessionId) {
      return byId.get(sessionId);
    },
    list() {
      return Array.from(byId.values());
    }
  };
}
