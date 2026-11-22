import type { SignalCiphertext, SignalPeerAddress } from "./direct-messages";

export interface E2EEReadReceipt {
  version: 1;
  kind: "read_receipt";
  threadID: string;
  messageIDs: string[];
  readAt: number;
}

export interface E2EEActionsDeps {
  encrypt: (remote: SignalPeerAddress, plaintext: string | Uint8Array, now?: Date) => Promise<SignalCiphertext>;
  decrypt: (remote: SignalPeerAddress, ciphertext: SignalCiphertext) => Promise<Uint8Array>;
}

function normalizeReceiptInput(threadID: string, messageIDs: string[]): { threadID: string; messageIDs: string[] } {
  const normalizedThreadID = typeof threadID === "string" ? threadID.trim() : "";
  if (!normalizedThreadID) throw new TypeError("threadID is required");
  if (!Array.isArray(messageIDs) || messageIDs.length === 0) throw new TypeError("messageIDs must be a non-empty array");
  const ids = [...new Set(messageIDs.map((id) => typeof id === "string" ? id.trim() : ""))];
  if (ids.some((id) => !id) || ids.length > 500) throw new TypeError("messageIDs must contain 1-500 non-empty identifiers");
  return { threadID: normalizedThreadID, messageIDs: ids };
}

function parseReceipt(value: unknown): E2EEReadReceipt {
  if (!value || typeof value !== "object") throw new TypeError("Invalid E2EE action payload");
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || item.kind !== "read_receipt" ||
      typeof item.threadID !== "string" || !item.threadID.trim() ||
      !Array.isArray(item.messageIDs) || item.messageIDs.length === 0 ||
      item.messageIDs.length > 500 ||
      item.messageIDs.some((id) => typeof id !== "string" || !id.trim()) ||
      !Number.isSafeInteger(item.readAt) || Number(item.readAt) < 0) {
    throw new TypeError("Invalid E2EE read receipt");
  }
  return {
    version: 1,
    kind: "read_receipt",
    threadID: item.threadID,
    messageIDs: [...new Set((item.messageIDs as string[]).map((id) => id.trim()))],
    readAt: Number(item.readAt)
  };
}

/**
 * E2EE actions travel as encrypted Signal application payloads. This deliberately
 * does not call markAsRead/markAsSeen or emit a normal Messenger read receipt.
 */
export function createSignalE2EEActions(deps: E2EEActionsDeps) {
  if (typeof deps?.encrypt !== "function" || typeof deps?.decrypt !== "function") {
    throw new TypeError("Signal encrypt and decrypt operations are required");
  }

  return {
    async sendReadReceipt(
      remote: SignalPeerAddress,
      threadID: string,
      messageIDs: string[],
      now = new Date()
    ): Promise<SignalCiphertext> {
      const normalized = normalizeReceiptInput(threadID, messageIDs);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
      const receipt: E2EEReadReceipt = {
        version: 1,
        kind: "read_receipt",
        ...normalized,
        readAt: now.getTime()
      };
      return deps.encrypt(remote, Buffer.from(JSON.stringify(receipt), "utf8"), now);
    },

    async decryptReadReceipt(
      remote: SignalPeerAddress,
      ciphertext: SignalCiphertext
    ): Promise<E2EEReadReceipt> {
      const plaintext = await deps.decrypt(remote, ciphertext);
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(plaintext).toString("utf8"));
      } catch {
        throw new TypeError("E2EE action plaintext is not valid JSON");
      }
      return parseReceipt(decoded);
    }
  };
}
