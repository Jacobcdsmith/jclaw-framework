/** Shared in-process store for WhatsApp messages (inbound + outbound). */

export interface WhatsAppMessage {
  id: string;
  from: string;
  to?: string;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: number;
  status: "received" | "sent" | "failed";
  error?: string;
}

/** Mutable array shared between the webhook handler and protocol handlers. */
export const whatsappMessages: WhatsAppMessage[] = [];
