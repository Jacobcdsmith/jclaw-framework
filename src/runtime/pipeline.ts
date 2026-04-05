import { writeFileSync, appendFileSync } from "fs";
import { execSync } from "child_process";

export type PipeTargetType = "clipboard" | "file" | "webhook" | "script";

export interface ClipboardTarget {
  type: "clipboard";
}

export interface FileTarget {
  type: "file";
  path: string;
  /** "overwrite" (default) or "append" */
  mode?: "overwrite" | "append";
}

export interface WebhookTarget {
  type: "webhook";
  url: string;
  /** Extra headers as key:value pairs */
  headers?: Record<string, string>;
}

export interface ScriptTarget {
  type: "script";
  /** Command to run; response text is passed via stdin */
  command: string;
}

export type PipeTarget =
  | ClipboardTarget
  | FileTarget
  | WebhookTarget
  | ScriptTarget;

export interface PipeResult {
  target: PipeTargetType;
  ok: boolean;
  error?: string;
}

export async function pipeOutput(
  text: string,
  targets: PipeTarget[]
): Promise<PipeResult[]> {
  return Promise.all(targets.map((t) => runPipe(text, t)));
}

async function runPipe(text: string, target: PipeTarget): Promise<PipeResult> {
  try {
    switch (target.type) {
      case "clipboard":
        return pipeClipboard(text);
      case "file":
        return pipeFile(text, target);
      case "webhook":
        return pipeWebhook(text, target);
      case "script":
        return pipeScript(text, target);
    }
  } catch (err) {
    return {
      target: target.type,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function pipeClipboard(text: string): PipeResult {
  // Platform-aware clipboard write.
  const cmd =
    process.platform === "darwin"
      ? `echo ${JSON.stringify(text)} | pbcopy`
      : process.platform === "win32"
      ? `echo ${JSON.stringify(text)} | clip`
      : `echo ${JSON.stringify(text)} | xclip -selection clipboard`;

  try {
    execSync(cmd, { stdio: "pipe" });
    return { target: "clipboard", ok: true };
  } catch {
    // xclip not available — soft fail
    return {
      target: "clipboard",
      ok: false,
      error: "Clipboard tool not available (install xclip/pbcopy)"
    };
  }
}

function pipeFile(text: string, target: FileTarget): PipeResult {
  if (target.mode === "append") {
    appendFileSync(target.path, text + "\n", "utf8");
  } else {
    writeFileSync(target.path, text, "utf8");
  }
  return { target: "file", ok: true };
}

async function pipeWebhook(
  text: string,
  target: WebhookTarget
): Promise<PipeResult> {
  const resp = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...target.headers
    },
    body: JSON.stringify({ text })
  });

  if (!resp.ok) {
    return {
      target: "webhook",
      ok: false,
      error: `HTTP ${resp.status} ${resp.statusText}`
    };
  }

  return { target: "webhook", ok: true };
}

function pipeScript(text: string, target: ScriptTarget): PipeResult {
  execSync(target.command, {
    input: text,
    stdio: ["pipe", "inherit", "inherit"]
  });
  return { target: "script", ok: true };
}
