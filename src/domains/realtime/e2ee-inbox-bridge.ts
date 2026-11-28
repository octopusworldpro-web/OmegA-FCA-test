import type { MqttEvent } from "../../types/events";

export interface MessengerE2EEInboxMessage {
  id?: unknown;
  threadId?: unknown;
  senderId?: unknown;
  text?: unknown;
  timestampMs?: unknown;
}

function numericMessengerId(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  const account = raw.split("@", 1)[0].split(/[.:]/, 1)[0];
  return /^\d+$/.test(account) && account !== "0" ? account : null;
}

/** Convert a decrypted native Messenger DM into the legacy FCA callback shape. */
export function normalizeMessengerE2EEInboxMessage(input: MessengerE2EEInboxMessage): MqttEvent | null {
  if (!input || typeof input !== "object") return null;
  const messageID = typeof input.id === "string" ? input.id.trim() : "";
  const body = typeof input.text === "string" ? input.text : "";
  const threadID = numericMessengerId(input.threadId);
  const senderID = numericMessengerId(input.senderId);
  if (!messageID || !body.length || !threadID || !senderID) return null;

  const rawTimestamp = Number(input.timestampMs);
  const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : Date.now();
  return {
    type: "message",
    messageID,
    threadID,
    senderID,
    body,
    timestamp,
    isGroup: false,
    isE2EE: true
  } as MqttEvent;
}

/** Attach one lifecycle-owned E2EE message listener and return its disposer. */
export function attachE2EEInboxBridge(
  messenger: Loose,
  dispatch: (event: MqttEvent) => void,
  logger: (text: string, type?: string) => void = () => undefined
): () => void {
  if (!messenger || typeof messenger.on !== "function") return () => undefined;
  const onMessage = (message: MessengerE2EEInboxMessage) => {
    const event = normalizeMessengerE2EEInboxMessage(message);
    if (!event) {
      logger("E2EE inbox message ignored: invalid or unsupported direct-message payload", "warn");
      return;
    }
    try {
      dispatch(event);
    } catch (error) {
      logger("E2EE inbox callback dispatch failed: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  };
  messenger.on("message", onMessage);
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    if (typeof messenger.off === "function") messenger.off("message", onMessage);
    else if (typeof messenger.removeListener === "function") messenger.removeListener("message", onMessage);
  };
}
