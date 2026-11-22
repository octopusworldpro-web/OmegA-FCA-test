import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SenderKeyCiphertext } from "./sender-keys";
import type { SignalPeerAddress } from "./direct-messages";

const KEY_LENGTH = 64;
const IV_LENGTH = 16;
const MAC_LENGTH = 10;

type GroupCipherPort = {
  encrypt(groupId: string, localSender: SignalPeerAddress, plaintext: string | Uint8Array): Promise<SenderKeyCiphertext>;
  decrypt(ciphertext: SenderKeyCiphertext): Promise<Uint8Array>;
};

export interface EncryptedGroupMediaDescriptor {
  version: 1;
  algorithm: "AES-256-CBC-HMAC-SHA256";
  groupId: string;
  sender: SignalPeerAddress;
  iv: string;
  mac: string;
  digest: string;
  plaintextSize: number;
  ciphertextSize: number;
  encryptedKey: SenderKeyCiphertext;
  fileName?: string;
  contentType?: string;
}
type Dynamic = any;

function bytes(value: Uint8Array | Buffer): Buffer {
  if (!(value instanceof Uint8Array)) throw new TypeError("media must be a Buffer or Uint8Array");
  return Buffer.from(value);
}
function encode(value: Uint8Array): string { return Buffer.from(value).toString("base64"); }
function decode(value: string, label: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`${label} must be valid base64`);
  }
  return Buffer.from(value, "base64");
}
function validateSender(sender: SignalPeerAddress): SignalPeerAddress {
  if (!sender || typeof sender.name !== "string" || !sender.name.trim() ||
      !Number.isSafeInteger(sender.deviceId) || sender.deviceId < 1) {
    throw new TypeError("sender requires a non-empty name and positive deviceId");
  }
  return { name: sender.name.trim(), deviceId: sender.deviceId };
}
function validateGroup(groupId: string): string {
  if (typeof groupId !== "string" || !groupId.trim()) throw new TypeError("groupId is required");
  return groupId.trim();
}
function mac(key: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  return createHmac("sha256", key).update(iv).update(ciphertext).digest().subarray(0, MAC_LENGTH);
}

/** Group media uses a fresh attachment key wrapped by the group's Signal Sender Key. */
export function createSignalEncryptedGroupMedia(groups: GroupCipherPort) {
  if (!groups || typeof groups.encrypt !== "function" || typeof groups.decrypt !== "function") {
    throw new TypeError("Signal Sender Key group encrypt/decrypt API is required");
  }

  async function encrypt(
    groupId: string,
    localSender: SignalPeerAddress,
    media: Uint8Array | Buffer,
    metadata: { fileName?: string; contentType?: string } = {}
  ): Promise<{ descriptor: EncryptedGroupMediaDescriptor; ciphertext: Buffer }> {
    const group = validateGroup(groupId);
    const sender = validateSender(localSender);
    const plaintext = bytes(media);
    if (metadata.fileName !== undefined && (typeof metadata.fileName !== "string" || !metadata.fileName.trim())) throw new TypeError("fileName must be a non-empty string");
    if (metadata.contentType !== undefined && (typeof metadata.contentType !== "string" || !metadata.contentType.trim())) throw new TypeError("contentType must be a non-empty string");
    const key = randomBytes(KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encryptedKey = await groups.encrypt(group, sender, key);
    return {
      descriptor: {
        version: 1,
        algorithm: "AES-256-CBC-HMAC-SHA256",
        groupId: group,
        sender,
        iv: encode(iv),
        mac: encode(mac(key.subarray(32), iv, ciphertext)),
        digest: createHash("sha256").update(ciphertext).digest("hex"),
        plaintextSize: plaintext.length,
        ciphertextSize: ciphertext.length,
        encryptedKey,
        ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
        ...(metadata.contentType ? { contentType: metadata.contentType } : {})
      },
      ciphertext
    };
  }

  async function decrypt(descriptor: EncryptedGroupMediaDescriptor, ciphertextInput: Uint8Array | Buffer): Promise<Buffer> {
    if (!descriptor || descriptor.version !== 1 || descriptor.algorithm !== "AES-256-CBC-HMAC-SHA256") throw new TypeError("Unsupported encrypted group media descriptor");
    const groupId = validateGroup(descriptor.groupId);
    const sender = validateSender(descriptor.sender);
    const ciphertext = bytes(ciphertextInput);
    const iv = decode(descriptor.iv, "iv");
    const suppliedMac = decode(descriptor.mac, "mac");
    if (iv.length !== IV_LENGTH || suppliedMac.length !== MAC_LENGTH || ciphertext.length === 0 || ciphertext.length % 16 !== 0) throw new TypeError("Invalid encrypted group media dimensions");
    if (descriptor.ciphertextSize !== ciphertext.length || createHash("sha256").update(ciphertext).digest("hex") !== descriptor.digest) throw new Error("Encrypted group media digest mismatch");
    if (!descriptor.encryptedKey || descriptor.encryptedKey.groupId !== groupId ||
        descriptor.encryptedKey.sender.name !== sender.name || descriptor.encryptedKey.sender.deviceId !== sender.deviceId) {
      throw new Error("Encrypted group media key routing mismatch");
    }
    const key = Buffer.from(await groups.decrypt(descriptor.encryptedKey));
    if (key.length !== KEY_LENGTH) throw new Error("Invalid decrypted group media key length");
    const expected = mac(key.subarray(32), iv, ciphertext);
    if (!timingSafeEqual(expected, suppliedMac)) throw new Error("Encrypted group media MAC verification failed");
    const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length !== descriptor.plaintextSize) throw new Error("Decrypted group media size mismatch");
    return plaintext;
  }

  async function encryptAndUpload(
    groupId: string,
    localSender: SignalPeerAddress,
    media: Uint8Array | Buffer,
    upload: (ciphertext: Buffer, metadata: { fileName: string; contentType: string }) => Promise<Dynamic>,
    metadata: { fileName?: string; contentType?: string } = {}
  ): Promise<{ descriptor: EncryptedGroupMediaDescriptor; upload: Dynamic }> {
    if (typeof upload !== "function") throw new TypeError("upload callback is required");
    const encrypted = await encrypt(groupId, localSender, media, metadata);
    const uploaded = await upload(Buffer.from(encrypted.ciphertext), {
      fileName: `${metadata.fileName || "attachment"}.enc`,
      contentType: "application/octet-stream"
    });
    if (uploaded === undefined || uploaded === null) throw new Error("Encrypted group media upload returned no result");
    return { descriptor: encrypted.descriptor, upload: uploaded };
  }

  return { encrypt, decrypt, encryptAndUpload };
}
