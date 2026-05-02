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

const MAX_MESSAGES = 500;

/** Mutable array shared between the webhook handler and protocol handlers. */
export const whatsappMessages: WhatsAppMessage[] = [];

/**
 * Prepend a message to the store, enforcing the MAX_MESSAGES cap.
 * Always use this instead of mutating `whatsappMessages` directly.
 */
export function pushWhatsAppMessage(msg: WhatsAppMessage): void {
  whatsappMessages.unshift(msg);
  if (whatsappMessages.length > MAX_MESSAGES) {
    whatsappMessages.length = MAX_MESSAGES;
  }
}
