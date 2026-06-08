type EventHandler = (event: string, payload: unknown) => void;
type RawFrameHandler = (frame: Record<string, unknown>) => void;
type StatusHandler = (connected: boolean) => void;

let ws: WebSocket | null = null;
let connectPromise: Promise<WebSocket> | null = null;
let isConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY_MS = 30_000;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const eventHandlers = new Set<EventHandler>();
const rawHandlers = new Set<RawFrameHandler>();
const statusHandlers = new Set<StatusHandler>();

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

function notifyStatus(connected: boolean) {
  isConnected = connected;
  for (const h of statusHandlers) h(connected);
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = Math.min(1_000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Errors are expected while the server is unavailable; scheduleReconnect will be
    // called again via onclose if the attempt fails.
    connect().catch(() => { });
  }, delay);
}

function connect(): Promise<WebSocket> {
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(getWsUrl());

    socket.onopen = () => {
      ws = socket;
      reconnectAttempt = 0;
      notifyStatus(true);
      resolve(socket);
    };

    socket.onclose = (ev) => {
      ws = null;
      connectPromise = null;
      notifyStatus(false);
      for (const { reject: r } of pending.values()) {
        r(new Error("WebSocket closed"));
      }
      pending.clear();
      // 1000 = normal closure, 1001 = going away (page unload) — no reconnect needed.
      if (ev.code !== 1000 && ev.code !== 1001) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      connectPromise = null;
      reject(new Error("Could not connect to gate server"));
    };

    socket.onmessage = (ev) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      for (const h of rawHandlers) {
        try { h(frame); } catch { }
      }

      if (frame.type === "res" && typeof frame.id === "string") {
        const p = pending.get(frame.id);
        if (p) {
          pending.delete(frame.id);
          if (frame.ok) {
            p.resolve(frame.payload);
          } else {
            p.reject(new Error((frame.error as string) ?? "Unknown error"));
          }
        }
      } else if (frame.type === "event" && typeof frame.event === "string") {
        for (const h of eventHandlers) {
          try { h(frame.event, frame.payload); } catch { }
        }
      }
    };
  });

  return connectPromise;
}

export async function call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  const socket = await connect();
  const id = makeId();
  const reqFrame = { type: "req", id, method, params: params ?? {} };
  for (const h of rawHandlers) {
    try { h(reqFrame as unknown as Record<string, unknown>); } catch { }
  }
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    socket.send(JSON.stringify(reqFrame));
  });
}

export function onEvent(handler: EventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

export function onRawFrame(handler: RawFrameHandler): () => void {
  rawHandlers.add(handler);
  connect().catch(() => { });
  return () => rawHandlers.delete(handler);
}

export function onStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

export function getStatus(): boolean {
  return isConnected;
}

export async function ensureConnected(): Promise<void> {
  await connect();
}
