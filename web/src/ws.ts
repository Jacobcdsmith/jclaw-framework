let ws: WebSocket | null = null;
let connectPromise: Promise<WebSocket> | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

function connect(): Promise<WebSocket> {
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(getWsUrl());

    socket.onopen = () => {
      ws = socket;
      resolve(socket);
    };

    socket.onclose = () => {
      ws = null;
      connectPromise = null;
      for (const { reject: r } of pending.values()) {
        r(new Error("WebSocket closed"));
      }
      pending.clear();
    };

    socket.onerror = (e) => {
      connectPromise = null;
      reject(new Error("WebSocket error: " + String(e)));
    };

    socket.onmessage = (ev) => {
      let frame: { type: string; id?: string; ok?: boolean; payload?: unknown; error?: string };
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (frame.type === "res" && frame.id) {
        const p = pending.get(frame.id);
        if (p) {
          pending.delete(frame.id);
          if (frame.ok) {
            p.resolve(frame.payload);
          } else {
            p.reject(new Error(frame.error ?? "Unknown error"));
          }
        }
      }
    };
  });

  return connectPromise;
}

export async function call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  const socket = await connect();
  const id = makeId();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    socket.send(JSON.stringify({ type: "req", id, method, params: params ?? {} }));
  });
}
