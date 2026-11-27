import type { SignalPeerAddress } from "./direct-messages";
import type { SignalMediaCrypto } from "./encrypted-media";
import {
  encryptAndUploadSignalMedia,
  downloadAndDecryptSignalMedia,
  type UploadedEncryptedMediaDescriptor
} from "./encrypted-media";

export interface EncryptedDirectMediaEnvelope {
  version: 1;
  kind: "direct_media";
  peerId: string;
  descriptor: Omit<UploadedEncryptedMediaDescriptor, "upload">;
  upload: unknown;
}

export interface SignalDirectMediaMessagingDeps {
  signal: SignalMediaCrypto;
  sendEnvelope(peerId: string, remote: SignalPeerAddress, envelope: EncryptedDirectMediaEnvelope): Promise<void>;
}

function normalizePeerId(value: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new TypeError("peerId must be numeric");
  return value;
}
function validateEnvelope(value: unknown): EncryptedDirectMediaEnvelope {
  if (!value || typeof value !== "object") throw new TypeError("encrypted direct media envelope is required");
  const item = value as Partial<EncryptedDirectMediaEnvelope>;
  if (item.version !== 1 || item.kind !== "direct_media" || !item.descriptor ||
      typeof item.descriptor !== "object" || item.upload === undefined || item.upload === null) {
    throw new TypeError("unsupported encrypted direct media envelope");
  }
  const peerId = normalizePeerId(item.peerId || "");
  const descriptor = item.descriptor as Omit<UploadedEncryptedMediaDescriptor, "upload">;
  if (descriptor.version !== 1 || descriptor.algorithm !== "AES-256-CBC-HMAC-SHA256" ||
      typeof descriptor.iv !== "string" || typeof descriptor.mac !== "string" ||
      typeof descriptor.digest !== "string" || !descriptor.encryptedKey ||
      !Number.isSafeInteger(descriptor.plaintextSize) || !Number.isSafeInteger(descriptor.ciphertextSize)) {
    throw new TypeError("invalid encrypted direct media descriptor");
  }
  return { version: 1, kind: "direct_media", peerId, descriptor, upload: item.upload };
}

/** Uploads ciphertext using the caller's FCA attachment transport and sends only its key/metadata envelope over Signal. */
export function createSignalEncryptedDirectMediaMessaging(deps: SignalDirectMediaMessagingDeps) {
  if (!deps?.signal || typeof deps.sendEnvelope !== "function") {
    throw new TypeError("Signal direct-message engine and envelope transport are required");
  }
  return {
    async send(
      peerIdInput: string,
      remote: SignalPeerAddress,
      plaintext: Uint8Array | Buffer,
      upload: (ciphertext: Buffer, metadata: { fileName: string; contentType: string }) => Promise<unknown>,
      metadata: { fileName?: string; contentType?: string } = {}
    ) {
      const peerId = normalizePeerId(peerIdInput);
      if (remote.name !== peerId) throw new Error("remote Signal address does not match peerId");
      const result = await encryptAndUploadSignalMedia(deps.signal, remote, plaintext, upload, metadata);
      const { upload: uploadRef, ...descriptor } = result;
      const envelope = validateEnvelope({ version: 1, kind: "direct_media", peerId, descriptor, upload: uploadRef });
      await deps.sendEnvelope(peerId, remote, envelope);
      return envelope;
    },
    async receive(
      envelopeInput: unknown,
      remote: SignalPeerAddress,
      download: (upload: unknown, descriptor: Omit<UploadedEncryptedMediaDescriptor, "upload">) => Promise<Uint8Array | Buffer>
    ) {
      const envelope = validateEnvelope(envelopeInput);
      if (remote.name !== envelope.peerId) throw new Error("direct media envelope does not match expected peer");
      return downloadAndDecryptSignalMedia(
        deps.signal,
        remote,
        { ...envelope.descriptor, upload: envelope.upload },
        download
      );
    }
  };
}
