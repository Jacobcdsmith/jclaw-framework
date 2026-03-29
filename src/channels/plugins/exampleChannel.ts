import type { JclawChannelPlugin } from "../types.js";

export const exampleChannel: JclawChannelPlugin = {
  id: "example",
  meta: {
    id: "example",
    name: "Example Channel",
    description: "Logs outbound messages to stdout"
  },
  capabilities: {
    text: true,
    media: false
  },
  outbound: {
    async sendText(ctx) {
      console.log("[JCLAW:example] →", ctx.to, ctx.text);
      return { ok: true };
    }
  }
};
