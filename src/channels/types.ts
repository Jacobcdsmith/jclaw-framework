export interface ChannelMeta {
  id: string;
  name: string;
  description?: string;
}

export interface ChannelCapabilities {
  text: boolean;
  media: boolean;
}

export interface OutboundContext {
  to: string;
  text?: string;
}

export interface DeliveryResult {
  ok: boolean;
  raw?: unknown;
}

export interface ChannelOutboundAdapter {
  sendText: (ctx: OutboundContext) => Promise<DeliveryResult>;
  sendMedia?: (ctx: OutboundContext) => Promise<DeliveryResult>;
  chunker?: (text: string, limit: number) => string[];
  normalizePayload?: (payload: unknown) => unknown;
}

export interface JclawChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  outbound: ChannelOutboundAdapter;
}
