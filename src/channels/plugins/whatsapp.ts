import type { JclawChannelPlugin, OutboundContext, DeliveryResult } from "../types.js";

const WHATSAPP_API_VERSION = "v20.0";
const WHATSAPP_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// Node 18+ ships global fetch. Guard against environments where it may be missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _globalFetch = (globalThis as any).fetch as
  | ((url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>)
  | undefined;

export interface WhatsAppSendOptions {
  phoneNumberId: string;
  accessToken: string;
}

export async function sendWhatsAppText(
  to: string,
  text: string,
  opts: WhatsAppSendOptions
): Promise<DeliveryResult> {
  if (!_globalFetch) {
    return { ok: false, error: "fetch is not available in this runtime (Node 18+ required)" };
  }
  const url = `${WHATSAPP_BASE}/${opts.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text }
  };

  const resp = await _globalFetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const errMsg = (raw as { error?: { message?: string } }).error?.message ?? `HTTP ${resp.status}`;
    return { ok: false, raw, error: errMsg };
  }

  return { ok: true, raw };
}

export function createWhatsAppPlugin(opts: WhatsAppSendOptions): JclawChannelPlugin {
  return {
    id: "whatsapp",
    meta: {
      id: "whatsapp",
      name: "WhatsApp Business",
      description: "Meta WhatsApp Business Cloud API outbound adapter"
    },
    capabilities: { text: true, media: false },
    outbound: {
      async sendText(ctx: OutboundContext): Promise<DeliveryResult> {
        if (!opts.phoneNumberId || !opts.accessToken) {
          return { ok: false, error: "WhatsApp not configured (missing phoneNumberId or accessToken)" };
        }
        return sendWhatsAppText(ctx.to, ctx.text ?? "", opts);
      }
    }
  };
}
