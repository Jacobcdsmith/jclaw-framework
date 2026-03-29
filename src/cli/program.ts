import { Command } from "commander";
import { WebSocket } from "ws";
import { startJclawGate } from "../gate/server.js";
import type { ResponseFrameT } from "../gate/protocol.js";

async function callJclaw<TPayload = unknown>(
  method: string,
  params: unknown,
  port: number
): Promise<TPayload> {
  const url = `ws://127.0.0.1:${port}`;

  return new Promise<TPayload>((resolve, reject) => {
    const socket = new WebSocket(url);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const cleanup = () => {
      socket.removeAllListeners?.("message");
      socket.removeAllListeners?.("error");
      socket.removeAllListeners?.("open");
    };

    socket.on("error", (err) => {
      cleanup();
      reject(err);
    });

    socket.on("open", () => {
      const frame = { type: "req", id, method, params };
      socket.send(JSON.stringify(frame));
    });

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }

      const res = parsed as Partial<ResponseFrameT>;
      if (res.type === "res" && res.id === id) {
        cleanup();
        socket.close();
        if (res.ok) {
          resolve((res.payload ?? null) as TPayload);
        } else {
          reject(new Error(res.error || "JCLaw request failed"));
        }
      }
    });
  });
}

export function buildJclawCli() {
  const program = new Command();
  program.name("jclaw").description("JCLaw parallel agent framework CLI");

  program
    .command("gate")
    .description("Start the JCLaw Gate server")
    .option("-p, --port <port>", "Port to listen on", "18789")
    .action(async (opts) => {
      const port = Number(opts.port ?? 18789);
      await startJclawGate({ port });
    });

  program
    .command("sessions:list")
    .description("List active JCLaw sessions via the gateway")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const port = Number(opts.port ?? 18789);
      try {
        const payload = await callJclaw<{ sessions: unknown[] }>(
          "sessions.list",
          {},
          port
        );
        console.log(JSON.stringify(payload.sessions, null, 2));
      } catch (err) {
        console.error("[JCLAW] sessions:list failed", err);
        process.exitCode = 1;
      }
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildJclawCli().parse(process.argv);
}
