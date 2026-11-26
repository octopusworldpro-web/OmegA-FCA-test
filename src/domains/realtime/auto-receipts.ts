export interface AutomaticReceiptMessage {
  threadID?: string | number;
  messageID?: string | number;
}

export interface AutomaticReceiptOptions {
  autoMarkRead?: boolean;
  autoMarkDelivery?: boolean;
}

/**
 * Dispatches standard Messenger delivery/read acknowledgements for an incoming
 * message. Calls are best-effort and never block delivery of the MQTT event.
 */
export function dispatchAutomaticReceipts(
  api: Record<string, Loose>,
  options: AutomaticReceiptOptions,
  message: AutomaticReceiptMessage,
  logger: (text: string, type?: string) => void = () => undefined
): void {
  const threadID = message?.threadID == null ? "" : String(message.threadID).trim();
  const messageID = message?.messageID == null ? "" : String(message.messageID).trim();
  if (!threadID) return;

  const dispatch = (name: string, operation: () => Loose) => {
    try {
      void Promise.resolve().then(operation).catch((error: Loose) => {
        const detail = error?.message ? String(error.message) : String(error);
        logger(`Automatic ${name} receipt failed: ${detail}`, "warn");
      });
    } catch (error: Loose) {
      const detail = error?.message ? String(error.message) : String(error);
      logger(`Automatic ${name} receipt failed: ${detail}`, "warn");
    }
  };

  if (options.autoMarkDelivery && messageID && typeof api.markAsDelivered === "function") {
    dispatch("delivery", () => api.markAsDelivered(threadID, messageID));
  }

  if (options.autoMarkRead && typeof api.markAsRead === "function") {
    dispatch("read", () => api.markAsRead(threadID, true));
  }
}
