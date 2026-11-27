import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { encryptSignalDirectMessage, decryptSignalDirectMessage, type SignalDirectMessageDeps, type SignalPeerAddress, type SignalCiphertext } from "./direct-messages";

type Dynamic = any;
const MAC_LENGTH = 10;
const KEY_LENGTH = 64;
const IV_LENGTH = 16;

export interface EncryptedMediaDescriptor {
  version: 1;
  algorithm: "AES-256-CBC-HMAC-SHA256";
  ciphertext: Uint8Array;
  iv: string;
  mac: string;
  digest: string;
  plaintextSize: number;
  ciphertextSize: number;
  encryptedKey: SignalCiphertext;
  fileName?: string;
  contentType?: string;
}
export type UploadedEncryptedMediaDescriptor = Omit<EncryptedMediaDescriptor, "ciphertext"> & { upload: unknown };

function toBytes(value: Uint8Array | Buffer): Buffer {
  if (!(value instanceof Uint8Array)) throw new TypeError("media must be a Buffer or Uint8Array");
  return Buffer.from(value);
}
function b64(value: Uint8Array): string { return Buffer.from(value).toString("base64"); }
function decode(value: string, label: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError(`${label} must be valid base64`);
  return Buffer.from(value, "base64");
}
function attachmentMac(macKey: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  return createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, MAC_LENGTH);
}

/** Encrypts binary media locally and wraps the random attachment key in the peer's Signal session. */
export async function encryptSignalMedia(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  media: Uint8Array | Buffer,
  metadata: { fileName?: string; contentType?: string } = {}
): Promise<EncryptedMediaDescriptor> {
  const plaintext = toBytes(media);
  if (metadata.fileName !== undefined && (typeof metadata.fileName !== "string" || !metadata.fileName.trim())) throw new TypeError("fileName must be a non-empty string");
  if (metadata.contentType !== undefined && (typeof metadata.contentType !== "string" || !metadata.contentType.trim())) throw new TypeError("contentType must be a non-empty string");
  const key = randomBytes(KEY_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = attachmentMac(key.subarray(32), iv, ciphertext);
  const encryptedKey = await encryptSignalDirectMessage(deps, remote, key);
  return {
    version: 1,
    algorithm: "AES-256-CBC-HMAC-SHA256",
    ciphertext,
    iv: b64(iv),
    mac: b64(mac),
    digest: createHash("sha256").update(ciphertext).digest("hex"),
    plaintextSize: plaintext.length,
    ciphertextSize: ciphertext.length,
    encryptedKey,
    ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
    ...(metadata.contentType ? { contentType: metadata.contentType } : {})
  };
}

/** Verifies ciphertext digest and MAC before decrypting; the attachment key arrives in a Signal DM. */
export async function decryptSignalMedia(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  descriptor: EncryptedMediaDescriptor
): Promise<Buffer> {
  if (!descriptor || descriptor.version !== 1 || descriptor.algorithm !== "AES-256-CBC-HMAC-SHA256") throw new TypeError("Unsupported encrypted media descriptor");
  const ciphertext = toBytes(descriptor.ciphertext);
  const iv = decode(descriptor.iv, "iv");
  const suppliedMac = decode(descriptor.mac, "mac");
  if (iv.length !== IV_LENGTH || suppliedMac.length !== MAC_LENGTH || ciphertext.length === 0 || ciphertext.length % 16 !== 0) throw new TypeError("Invalid encrypted media dimensions");
  if (!Number.isSafeInteger(descriptor.plaintextSize) || descriptor.plaintextSize < 0 ||
      descriptor.ciphertextSize !== ciphertext.length || typeof descriptor.digest !== "string" ||
      !/^[a-f0-9]{64}$/i.test(descriptor.digest) ||
      createHash("sha256").update(ciphertext).digest("hex") !== descriptor.digest) throw new Error("Encrypted media digest or size mismatch");
  const keyBytes = await decryptSignalDirectMessage(deps, remote, descriptor.encryptedKey);
  const key = Buffer.from(keyBytes);
  if (key.length !== KEY_LENGTH) throw new Error("Invalid decrypted media key length");
  const expectedMac = attachmentMac(key.subarray(32), iv, ciphertext);
  if (!timingSafeEqual(expectedMac, suppliedMac)) throw new Error("Encrypted media MAC verification failed");
  const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length !== descriptor.plaintextSize) throw new Error("Decrypted media size mismatch");
  return plaintext;
}

/** Convenience composition: encrypt locally, upload only ciphertext, and return transport-safe metadata. */
export async function encryptAndUploadSignalMedia(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  media: Uint8Array | Buffer,
  upload: (ciphertext: Buffer, metadata: { fileName: string; contentType: string }) => Promise<Dynamic>,
  metadata: { fileName?: string; contentType?: string } = {}
): Promise<Omit<EncryptedMediaDescriptor, "ciphertext"> & { upload: Dynamic }> {
  if (typeof upload !== "function") throw new TypeError("upload callback is required");
  const encrypted = await encryptSignalMedia(deps, remote, media, metadata);
  const uploaded = await upload(Buffer.from(encrypted.ciphertext), {
    fileName: `${metadata.fileName || "attachment"}.enc`,
    contentType: "application/octet-stream"
  });
  if (uploaded === undefined || uploaded === null) throw new Error("Encrypted media upload returned no result");
  const { ciphertext: _ciphertext, ...descriptor } = encrypted;
  return { ...descriptor, upload: uploaded };
}


/** Downloads ciphertext through the caller's existing FCA attachment path, then verifies and decrypts it. */
export async function downloadAndDecryptSignalMedia(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  descriptor: UploadedEncryptedMediaDescriptor,
  download: (upload: Dynamic, descriptor: UploadedEncryptedMediaDescriptor) => Promise<Uint8Array | Buffer>
): Promise<Buffer> {
  if (!descriptor || descriptor.version !== 1 || descriptor.algorithm !== "AES-256-CBC-HMAC-SHA256" ||
      descriptor.upload === undefined || descriptor.upload === null) {
    throw new TypeError("Uploaded encrypted media descriptor is required");
  }
  if (typeof download !== "function") throw new TypeError("download callback is required");
  const ciphertext = await download(descriptor.upload, descriptor);
  if (!(ciphertext instanceof Uint8Array)) throw new TypeError("download callback must return ciphertext bytes");
  return decryptSignalMedia(deps, remote, { ...descriptor, ciphertext });
}
