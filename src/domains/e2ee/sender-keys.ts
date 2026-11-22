import type { SignalPeerAddress } from "./direct-messages";
import type { SignalKeyStore } from "./signal-key-store";
import { createLibsignalSenderKeyStore } from "./libsignal-adapter";

type Dynamic = any;
export interface SenderKeyDistribution {
  groupId: string;
  sender: SignalPeerAddress;
  body: string;
}
export interface SenderKeyCiphertext {
  groupId: string;
  sender: SignalPeerAddress;
  body: string;
}

function validatePeer(peer: SignalPeerAddress): SignalPeerAddress {
  if (!peer || typeof peer.name !== "string" || !peer.name.trim() ||
      !Number.isSafeInteger(peer.deviceId) || peer.deviceId < 1) {
    throw new TypeError("sender requires a non-empty name and positive deviceId");
  }
  return { name: peer.name.trim(), deviceId: peer.deviceId };
}
function validateGroupId(groupId: string): string {
  if (typeof groupId !== "string" || !groupId.trim()) throw new TypeError("groupId is required");
  return groupId.trim();
}
function requireSignal(signal: Dynamic): void {
  if (!signal?.ProtocolAddress?.new || !signal?.SenderKeyName?.new ||
      !signal?.SenderKeyDistributionMessage?.deserialize || !signal?.GroupSessionBuilder ||
      !signal?.GroupCipher || !signal?.SenderKeyMessage?.deserialize) {
    throw new TypeError("A compatible libsignal group sender-key API is required");
  }
}
function senderKeyName(signal: Dynamic, groupId: string, peer: SignalPeerAddress): Dynamic {
  const normalized = validatePeer(peer);
  return signal.SenderKeyName.new(
    validateGroupId(groupId),
    signal.ProtocolAddress.new(normalized.name, normalized.deviceId)
  );
}

/**
 * Signal Sender Keys group protocol. Each sender creates one distribution message
 * per group/device; recipients process it before group ciphertext can be decrypted.
 */
export function createSignalSenderKeyGroups(signal: Dynamic, keyStore: SignalKeyStore) {
  requireSignal(signal);
  const senderKeyStore = createLibsignalSenderKeyStore(signal, keyStore);

  return {
    async createDistribution(groupId: string, localSender: SignalPeerAddress): Promise<SenderKeyDistribution> {
      const normalizedGroup = validateGroupId(groupId);
      const sender = validatePeer(localSender);
      const name = senderKeyName(signal, normalizedGroup, sender);
      const builder = new signal.GroupSessionBuilder(senderKeyStore);
      const distribution = await builder.createSenderKeyDistributionMessage(name);
      return { groupId: normalizedGroup, sender, body: Buffer.from(distribution.serialize()).toString("base64") };
    },

    async processDistribution(distribution: SenderKeyDistribution): Promise<void> {
      if (!distribution || typeof distribution.body !== "string" || !distribution.body.trim()) {
        throw new TypeError("sender-key distribution body is required");
      }
      const normalizedGroup = validateGroupId(distribution.groupId);
      const sender = validatePeer(distribution.sender);
      const bytes = Buffer.from(distribution.body, "base64");
      if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== distribution.body.replace(/=+$/, "")) {
        throw new TypeError("sender-key distribution body must be valid base64");
      }
      const name = senderKeyName(signal, normalizedGroup, sender);
      const message = signal.SenderKeyDistributionMessage.deserialize(bytes);
      const builder = new signal.GroupSessionBuilder(senderKeyStore);
      await builder.processSenderKeyDistributionMessage(name, message);
    },

    async encrypt(groupId: string, localSender: SignalPeerAddress, plaintext: string | Uint8Array): Promise<SenderKeyCiphertext> {
      const normalizedGroup = validateGroupId(groupId);
      const sender = validatePeer(localSender);
      if (typeof plaintext !== "string" && !(plaintext instanceof Uint8Array)) {
        throw new TypeError("plaintext must be a string or Uint8Array");
      }
      const name = senderKeyName(signal, normalizedGroup, sender);
      const cipher = new signal.GroupCipher(name, senderKeyStore);
      const encrypted = await cipher.encrypt(typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext);
      return { groupId: normalizedGroup, sender, body: Buffer.from(encrypted).toString("base64") };
    },

    async decrypt(ciphertext: SenderKeyCiphertext): Promise<Uint8Array> {
      if (!ciphertext || typeof ciphertext.body !== "string" || !ciphertext.body.trim()) {
        throw new TypeError("sender-key ciphertext body is required");
      }
      const normalizedGroup = validateGroupId(ciphertext.groupId);
      const sender = validatePeer(ciphertext.sender);
      const bytes = Buffer.from(ciphertext.body, "base64");
      if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== ciphertext.body.replace(/=+$/, "")) {
        throw new TypeError("sender-key ciphertext body must be valid base64");
      }
      const name = senderKeyName(signal, normalizedGroup, sender);
      const cipher = new signal.GroupCipher(name, senderKeyStore);
      return Uint8Array.from(await cipher.decrypt(signal.SenderKeyMessage.deserialize(bytes)));
    },

    senderKeyStore
  };
}
