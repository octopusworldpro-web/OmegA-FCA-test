export type E2EESendMessagePayload = string | {
  body?: unknown;
  attachment?: unknown;
  sticker?: unknown;
  emoji?: unknown;
  location?: unknown;
  forwardAttachmentIds?: unknown;
  mentions?: unknown;
  [key: string]: unknown;
};

export interface E2EESendMessageRouterOptions {
  isE2EEThread: (threadID: string) => boolean;
  sendDirectText: (peerID: string, text: string) => Promise<string>;
}

/**
 * Route legacy sendMessage calls for threads observed on the native E2EE
 * Inbox transport. Never fall back to plaintext MQTT for an E2EE thread.
 */
export function createE2EESendMessageRouter(
  sendLegacy: (...args: any[]) => any,
  options: E2EESendMessageRouterOptions
) {
  if (typeof sendLegacy !== "function") throw new TypeError("sendLegacy must be a function");
  if (typeof options?.isE2EEThread !== "function" || typeof options?.sendDirectText !== "function") {
    throw new TypeError("E2EE send routing requires thread detection and a direct-text transport");
  }

  return async function sendMessage(
    message: E2EESendMessagePayload,
    threadID: string,
    callback?: ((error?: unknown, result?: unknown) => void) | string,
    replyToMessage?: string
  ) {
    const peerID = String(threadID ?? "");
    if (!options.isE2EEThread(peerID)) {
      return sendLegacy(message, threadID, callback, replyToMessage);
    }

    let result: { body: string; messageID: string; threadID: string; isE2EE: true };
    try {
      const body = typeof message === "string"
        ? message
        : message && typeof message === "object" && typeof message.body === "string"
          ? message.body
          : undefined;
      if (body === undefined) {
        throw new Error("E2EE direct-message transport currently supports text payloads only; plaintext fallback is disabled");
      }

      if (typeof message === "object" && message !== null) {
        const unsupported = ["attachment", "sticker", "emoji", "location", "forwardAttachmentIds", "mentions"]
          .some((key) => {
            const value = message[key];
            return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false;
          });
        if (unsupported) {
          throw new Error("This E2EE reply contains unsupported media or metadata; plaintext fallback is disabled");
        }
      }

      const messageID = await options.sendDirectText(peerID, body);
      result = { body, messageID, threadID: peerID, isE2EE: true };
    } catch (error) {
      if (typeof callback === "function") callback(error);
      throw error;
    }
    if (typeof callback === "function") callback(undefined, result);
    return result;
  };
}
