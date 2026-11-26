import type { SignalCiphertext, SignalPeerAddress } from "./direct-messages";

export interface E2EEReadReceipt {
  version: 1;
  kind: "read_receipt";
  threadID: string;
  messageIDs: string[];
  readAt: number;
}
export interface E2EEDeliveryReceipt {
  version: 1;
  kind: "delivery_receipt";
  threadID: string;
  messageIDs: string[];
  deliveredAt: number;
}
export interface E2EETypingAction {
  version: 1;
  kind: "typing";
  threadID: string;
  active: boolean;
  sentAt: number;
  expiresAt: number;
}
export interface E2EEPresenceAction {
  version: 1;
  kind: "presence";
  state: "online" | "away" | "busy" | "offline";
  sentAt: number;
}
export type E2EEAction = E2EEReadReceipt | E2EEDeliveryReceipt | E2EETypingAction | E2EEPresenceAction;

export interface E2EEActionsDeps {
  encrypt: (remote: SignalPeerAddress, plaintext: string | Uint8Array, now?: Date) => Promise<SignalCiphertext>;
  decrypt: (remote: SignalPeerAddress, ciphertext: SignalCiphertext) => Promise<Uint8Array>;
}

function normalizeReceiptInput(threadID: string, messageIDs: string[]) {
  const normalizedThreadID = typeof threadID === "string" ? threadID.trim() : "";
  if (!normalizedThreadID) throw new TypeError("threadID is required");
  if (!Array.isArray(messageIDs) || messageIDs.length === 0) throw new TypeError("messageIDs must be a non-empty array");
  const ids = [...new Set(messageIDs.map((id) => typeof id === "string" ? id.trim() : ""))];
  if (ids.some((id) => !id) || ids.length > 500) throw new TypeError("messageIDs must contain 1-500 non-empty identifiers");
  return { threadID: normalizedThreadID, messageIDs: ids };
}
function timestamp(now: Date): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
  return now.getTime();
}
function parseAction(value: unknown): E2EEAction {
  if (!value || typeof value !== "object") throw new TypeError("Invalid E2EE action payload");
  const item = value as Record<string, unknown>;
  if (item.version !== 1) throw new TypeError("Unsupported E2EE action version");
  if (item.kind === "read_receipt" || item.kind === "delivery_receipt") {
    if (typeof item.threadID !== "string" || !item.threadID.trim() ||
        !Array.isArray(item.messageIDs) || item.messageIDs.length === 0 || item.messageIDs.length > 500 ||
        item.messageIDs.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError("Invalid E2EE receipt");
    }
    const messageIDs = [...new Set((item.messageIDs as string[]).map((id) => id.trim()))];
    const atKey = item.kind === "read_receipt" ? "readAt" : "deliveredAt";
    if (!Number.isSafeInteger(item[atKey]) || Number(item[atKey]) < 0) throw new TypeError("Invalid E2EE receipt timestamp");
    return item.kind === "read_receipt"
      ? { version: 1, kind: "read_receipt", threadID: item.threadID.trim(), messageIDs, readAt: Number(item.readAt) }
      : { version: 1, kind: "delivery_receipt", threadID: item.threadID.trim(), messageIDs, deliveredAt: Number(item.deliveredAt) };
  }
  if (item.kind === "typing") {
    if (typeof item.threadID !== "string" || !item.threadID.trim() || typeof item.active !== "boolean" ||
        !Number.isSafeInteger(item.sentAt) || Number(item.sentAt) < 0 ||
        !Number.isSafeInteger(item.expiresAt) || Number(item.expiresAt) < Number(item.sentAt) ||
        Number(item.expiresAt) - Number(item.sentAt) > 30_000) throw new TypeError("Invalid E2EE typing action");
    return { version: 1, kind: "typing", threadID: item.threadID.trim(), active: item.active, sentAt: Number(item.sentAt), expiresAt: Number(item.expiresAt) };
  }
  if (item.kind === "presence") {
    if (!["online", "away", "busy", "offline"].includes(String(item.state)) ||
        !Number.isSafeInteger(item.sentAt) || Number(item.sentAt) < 0) throw new TypeError("Invalid E2EE presence action");
    return { version: 1, kind: "presence", state: item.state as E2EEPresenceAction["state"], sentAt: Number(item.sentAt) };
  }
  throw new TypeError("Unsupported E2EE action kind");
}

/**
 * E2EE actions are encrypted Signal application payloads, not Messenger's private
 * wire protocol. They never invoke ordinary mark-read, delivery, typing or presence APIs.
 */
export function createSignalE2EEActions(deps: E2EEActionsDeps) {
  if (typeof deps?.encrypt !== "function" || typeof deps?.decrypt !== "function") {
    throw new TypeError("Signal encrypt and decrypt operations are required");
  }
  async function send(remote: SignalPeerAddress, action: E2EEAction, now: Date) {
    return deps.encrypt(remote, Buffer.from(JSON.stringify(action), "utf8"), now);
  }
  async function decryptAction(remote: SignalPeerAddress, ciphertext: SignalCiphertext): Promise<E2EEAction> {
    const plaintext = await deps.decrypt(remote, ciphertext);
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(plaintext).toString("utf8")); }
    catch { throw new TypeError("E2EE action plaintext is not valid JSON"); }
    return parseAction(decoded);
  }
  return {
    async sendReadReceipt(remote: SignalPeerAddress, threadID: string, messageIDs: string[], now = new Date()) {
      const at = timestamp(now);
      return send(remote, { version: 1, kind: "read_receipt", ...normalizeReceiptInput(threadID, messageIDs), readAt: at }, now);
    },
    async sendDeliveryReceipt(remote: SignalPeerAddress, threadID: string, messageIDs: string[], now = new Date()) {
      const at = timestamp(now);
      return send(remote, { version: 1, kind: "delivery_receipt", ...normalizeReceiptInput(threadID, messageIDs), deliveredAt: at }, now);
    },
    async sendTyping(remote: SignalPeerAddress, threadID: string, active: boolean, now = new Date()) {
      const at = timestamp(now);
      const id = typeof threadID === "string" ? threadID.trim() : "";
      if (!id) throw new TypeError("threadID is required");
      if (typeof active !== "boolean") throw new TypeError("active must be a boolean");
      return send(remote, { version: 1, kind: "typing", threadID: id, active, sentAt: at, expiresAt: active ? at + 10_000 : at }, now);
    },
    async sendPresence(remote: SignalPeerAddress, state: E2EEPresenceAction["state"], now = new Date()) {
      const at = timestamp(now);
      if (!["online", "away", "busy", "offline"].includes(state)) throw new TypeError("Invalid E2EE presence state");
      return send(remote, { version: 1, kind: "presence", state, sentAt: at }, now);
    },
    decryptAction,
    async decryptReadReceipt(remote: SignalPeerAddress, ciphertext: SignalCiphertext): Promise<E2EEReadReceipt> {
      const action = await decryptAction(remote, ciphertext);
      if (action.kind !== "read_receipt") throw new TypeError("Invalid E2EE read receipt");
      return action;
    },
    async decryptDeliveryReceipt(remote: SignalPeerAddress, ciphertext: SignalCiphertext): Promise<E2EEDeliveryReceipt> {
      const action = await decryptAction(remote, ciphertext);
      if (action.kind !== "delivery_receipt") throw new TypeError("Invalid E2EE delivery receipt");
      return action;
    }
  };
}
