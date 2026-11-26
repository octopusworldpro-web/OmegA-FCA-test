import type { SignalPeerAddress } from "./direct-messages";
import type { SenderKeyCiphertext, SenderKeyDistribution } from "./sender-keys";

export interface EncryptedGroupMessageEnvelope {
  version: 1;
  kind: "group_message";
  ciphertext: SenderKeyCiphertext;
}

export interface SignalGroupMessagingDeps {
  keyManager: {
    encrypt(groupId: string, sender: SignalPeerAddress, plaintext: string | Uint8Array): Promise<SenderKeyCiphertext>;
    decrypt(ciphertext: SenderKeyCiphertext, expected?: { groupId?: string; sender?: SignalPeerAddress }): Promise<Uint8Array>;
    processIncomingDistribution(distribution: SenderKeyDistribution): Promise<void>;
  };
  /** Sends only the opaque encrypted envelope over the caller's authenticated group transport. */
  sendEnvelope(groupId: string, envelope: EncryptedGroupMessageEnvelope): Promise<void>;
}

function groupId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("groupId is required");
  return value.trim();
}

function peer(value: SignalPeerAddress, label: string): SignalPeerAddress {
  if (!value || typeof value.name !== "string" || !value.name.trim() ||
      !Number.isSafeInteger(value.deviceId) || value.deviceId < 1) {
    throw new TypeError(`${label} requires a non-empty name and positive deviceId`);
  }
  return { name: value.name.trim(), deviceId: value.deviceId };
}

function validateEnvelope(value: unknown): EncryptedGroupMessageEnvelope {
  if (!value || typeof value !== "object") throw new TypeError("encrypted group envelope is required");
  const item = value as Partial<EncryptedGroupMessageEnvelope>;
  if (item.version !== 1 || item.kind !== "group_message" || !item.ciphertext ||
      typeof item.ciphertext !== "object") {
    throw new TypeError("unsupported encrypted group message envelope");
  }
  const ciphertext = item.ciphertext as SenderKeyCiphertext;
  const id = groupId(ciphertext.groupId);
  const sender = peer(ciphertext.sender, "ciphertext sender");
  if (typeof ciphertext.body !== "string" || !ciphertext.body.trim()) {
    throw new TypeError("group ciphertext body is required");
  }
  const bytes = Buffer.from(ciphertext.body, "base64");
  if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== ciphertext.body.replace(/=+$/, "")) {
    throw new TypeError("group ciphertext body must be valid base64");
  }
  return { version: 1, kind: "group_message", ciphertext: { groupId: id, sender, body: ciphertext.body } };
}

/**
 * Application-level encrypted group messaging over an injected authenticated transport.
 * Plaintext is encrypted with Signal Sender Keys before transport and never handed to the transport.
 */
export function createSignalEncryptedGroupMessaging(deps: SignalGroupMessagingDeps) {
  if (!deps?.keyManager || typeof deps.keyManager.encrypt !== "function" ||
      typeof deps.keyManager.decrypt !== "function" ||
      typeof deps.keyManager.processIncomingDistribution !== "function" ||
      typeof deps.sendEnvelope !== "function") {
    throw new TypeError("Signal group key manager and encrypted-envelope transport are required");
  }

  return {
    async send(groupIdInput: string, senderInput: SignalPeerAddress, plaintext: string | Uint8Array) {
      const id = groupId(groupIdInput);
      const sender = peer(senderInput, "local sender");
      if (typeof plaintext !== "string" && !(plaintext instanceof Uint8Array)) {
        throw new TypeError("group plaintext must be a string or Uint8Array");
      }
      const ciphertext = await deps.keyManager.encrypt(id, sender, plaintext);
      const envelope = validateEnvelope({ version: 1, kind: "group_message", ciphertext });
      if (envelope.ciphertext.groupId !== id ||
          envelope.ciphertext.sender.name !== sender.name ||
          envelope.ciphertext.sender.deviceId !== sender.deviceId) {
        throw new Error("group key manager returned ciphertext for a different group or sender");
      }
      await deps.sendEnvelope(id, envelope);
      return envelope;
    },

    async receive(envelopeInput: unknown, expected?: { groupId?: string; sender?: SignalPeerAddress }) {
      const envelope = validateEnvelope(envelopeInput);
      if (expected?.groupId !== undefined && groupId(expected.groupId) !== envelope.ciphertext.groupId) {
        throw new Error("encrypted group envelope does not match expected group");
      }
      if (expected?.sender !== undefined) {
        const sender = peer(expected.sender, "expected sender");
        if (sender.name !== envelope.ciphertext.sender.name ||
            sender.deviceId !== envelope.ciphertext.sender.deviceId) {
          throw new Error("encrypted group envelope does not match expected sender");
        }
      }
      return deps.keyManager.decrypt(envelope.ciphertext, expected);
    },

    async receiveDistribution(distribution: SenderKeyDistribution) {
      return deps.keyManager.processIncomingDistribution(distribution);
    }
  };
}
