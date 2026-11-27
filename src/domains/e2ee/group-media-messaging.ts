import type { SignalPeerAddress } from "./direct-messages";
import type { EncryptedGroupMediaDescriptor, EncryptedGroupMediaExpectedContext } from "./encrypted-group-media";
import type { EncryptedGroupMessageEnvelope } from "./group-messaging";

export interface EncryptedGroupMediaMessageEnvelope {
  version: 1;
  kind: "group_media";
  descriptor: EncryptedGroupMediaDescriptor;
  upload: unknown;
}

export interface SignalGroupMediaMessagingDeps {
  media: {
    encryptAndUpload(
      groupId: string,
      sender: SignalPeerAddress,
      plaintext: Uint8Array | Buffer,
      upload: (ciphertext: Buffer, metadata: { fileName: string; contentType: string }) => Promise<unknown>,
      metadata?: { fileName?: string; contentType?: string }
    ): Promise<{ descriptor: EncryptedGroupMediaDescriptor; upload: unknown }>;
    downloadAndDecrypt(
      descriptor: EncryptedGroupMediaDescriptor,
      download: (descriptor: EncryptedGroupMediaDescriptor, upload: unknown) => Promise<Uint8Array | Buffer>,
      expected?: EncryptedGroupMediaExpectedContext
    ): Promise<Buffer>;
  };
  sendEnvelope(groupId: string, envelope: EncryptedGroupMediaMessageEnvelope): Promise<void>;
}

function normalizeGroup(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("groupId is required");
  return value.trim();
}
function normalizeSender(value: SignalPeerAddress): SignalPeerAddress {
  if (!value || typeof value.name !== "string" || !value.name.trim() ||
      !Number.isSafeInteger(value.deviceId) || value.deviceId < 1) {
    throw new TypeError("sender requires a non-empty name and positive deviceId");
  }
  return { name: value.name.trim(), deviceId: value.deviceId };
}
function validateEnvelope(value: unknown): EncryptedGroupMediaMessageEnvelope {
  if (!value || typeof value !== "object") throw new TypeError("encrypted group media envelope is required");
  const item = value as Partial<EncryptedGroupMediaMessageEnvelope>;
  if (item.version !== 1 || item.kind !== "group_media" || !item.descriptor ||
      typeof item.descriptor !== "object" || item.upload === undefined || item.upload === null) {
    throw new TypeError("unsupported encrypted group media envelope");
  }
  const descriptor = item.descriptor;
  const groupId = normalizeGroup(descriptor.groupId);
  const sender = normalizeSender(descriptor.sender);
  if (descriptor.version !== 1 || descriptor.algorithm !== "AES-256-CBC-HMAC-SHA256" ||
      typeof descriptor.iv !== "string" || typeof descriptor.mac !== "string" ||
      typeof descriptor.digest !== "string" || !descriptor.encryptedKey ||
      descriptor.encryptedKey.groupId !== groupId ||
      descriptor.encryptedKey.sender?.name !== sender.name ||
      descriptor.encryptedKey.sender?.deviceId !== sender.deviceId) {
    throw new TypeError("invalid encrypted group media descriptor");
  }
  return { version: 1, kind: "group_media", descriptor: { ...descriptor, groupId, sender }, upload: item.upload };
}

/** Composes group media encryption with an authenticated group-envelope transport. */
export function createSignalEncryptedGroupMediaMessaging(deps: SignalGroupMediaMessagingDeps) {
  if (!deps?.media || typeof deps.media.encryptAndUpload !== "function" ||
      typeof deps.media.downloadAndDecrypt !== "function" || typeof deps.sendEnvelope !== "function") {
    throw new TypeError("encrypted group media engine and envelope transport are required");
  }
  return {
    async send(
      groupIdInput: string,
      senderInput: SignalPeerAddress,
      plaintext: Uint8Array | Buffer,
      upload: (ciphertext: Buffer, metadata: { fileName: string; contentType: string }) => Promise<unknown>,
      metadata: { fileName?: string; contentType?: string } = {}
    ) {
      const groupId = normalizeGroup(groupIdInput);
      const sender = normalizeSender(senderInput);
      const result = await deps.media.encryptAndUpload(groupId, sender, plaintext, upload, metadata);
      const envelope = validateEnvelope({ version: 1, kind: "group_media", ...result });
      if (envelope.descriptor.groupId !== groupId ||
          envelope.descriptor.sender.name !== sender.name ||
          envelope.descriptor.sender.deviceId !== sender.deviceId) {
        throw new Error("group media engine returned a descriptor for a different group or sender");
      }
      await deps.sendEnvelope(groupId, envelope);
      return envelope;
    },
    async receive(
      envelopeInput: unknown,
      download: (descriptor: EncryptedGroupMediaDescriptor, upload: unknown) => Promise<Uint8Array | Buffer>,
      expected?: EncryptedGroupMediaExpectedContext
    ) {
      const envelope = validateEnvelope(envelopeInput);
      if (expected?.groupId !== undefined && normalizeGroup(expected.groupId) !== envelope.descriptor.groupId) {
        throw new Error("encrypted group media envelope does not match expected group");
      }
      if (expected?.sender !== undefined) {
        const sender = normalizeSender(expected.sender);
        if (sender.name !== envelope.descriptor.sender.name || sender.deviceId !== envelope.descriptor.sender.deviceId) {
          throw new Error("encrypted group media envelope does not match expected sender");
        }
      }
      if (typeof download !== "function") throw new TypeError("download callback is required");
      return deps.media.downloadAndDecrypt(
        envelope.descriptor,
        (descriptor) => download(descriptor, envelope.upload),
        expected
      );
    }
  };
}
