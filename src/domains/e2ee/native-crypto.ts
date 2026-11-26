import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from "node:crypto";

/**
 * OmegA-owned low-level primitives used by the Signal-compatible protocol layers.
 * These primitives are not, by themselves, a Signal implementation or Messenger wire format.
 */
export interface OmegAKeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

const X25519_PUBLIC_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PRIVATE_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function require32(value: Uint8Array, label: string): Buffer {
  const result = Buffer.from(value);
  if (result.length !== KEY_BYTES) throw new TypeError(`${label} must be exactly 32 bytes`);
  return result;
}

export function generateOmegAX25519KeyPair(): OmegAKeyPair {
  const pair = generateKeyPairSync("x25519");
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  const privateDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
  return {
    publicKey: Buffer.from(publicDer).subarray(-KEY_BYTES),
    privateKey: Buffer.from(privateDer).subarray(-KEY_BYTES)
  };
}

export function deriveOmegAX25519(privateKey: Uint8Array, publicKey: Uint8Array): Buffer {
  const secret = require32(privateKey, "privateKey");
  const peer = require32(publicKey, "publicKey");
  const privateObject = createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_PREFIX, secret]),
    format: "der",
    type: "pkcs8"
  });
  const publicObject = createPublicKey({
    key: Buffer.concat([X25519_PUBLIC_PREFIX, peer]),
    format: "der",
    type: "spki"
  });
  const shared = diffieHellman({ privateKey: privateObject, publicKey: publicObject });
  if (shared.length !== KEY_BYTES || shared.every((byte) => byte === 0)) {
    throw new Error("X25519 produced an invalid all-zero shared secret");
  }
  return shared;
}

export function deriveOmegAHKDF(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = KEY_BYTES
): Buffer {
  if (typeof info !== "string" || !info.length) throw new TypeError("HKDF info is required");
  if (!Number.isSafeInteger(length) || length < 1 || length > 8160) {
    throw new RangeError("HKDF output length must be between 1 and 8160 bytes");
  }
  const output = hkdfSync("sha256", Buffer.from(inputKeyMaterial), Buffer.from(salt), info, length);
  return Buffer.from(output);
}

export interface OmegAAeadCiphertext {
  nonce: string;
  ciphertext: string;
  tag: string;
}

export function encryptOmegAAes256Gcm(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array = Buffer.alloc(0),
  nonce: Uint8Array = randomBytes(NONCE_BYTES)
): OmegAAeadCiphertext {
  const secret = require32(key, "key");
  const iv = Buffer.from(nonce);
  if (iv.length !== NONCE_BYTES) throw new TypeError("nonce must be exactly 12 bytes");
  const cipher = createCipheriv("aes-256-gcm", secret, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    nonce: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptOmegAAes256Gcm(
  key: Uint8Array,
  value: OmegAAeadCiphertext,
  associatedData: Uint8Array = Buffer.alloc(0)
): Buffer {
  const secret = require32(key, "key");
  if (!value || typeof value.nonce !== "string" ||
      typeof value.ciphertext !== "string" || typeof value.tag !== "string") {
    throw new TypeError("ciphertext requires nonce, ciphertext, and tag base64 fields");
  }
  const nonce = Buffer.from(value.nonce, "base64");
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  const tag = Buffer.from(value.tag, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES ||
      nonce.toString("base64") !== value.nonce ||
      ciphertext.toString("base64") !== value.ciphertext ||
      tag.toString("base64") !== value.tag) {
    throw new TypeError("ciphertext contains invalid base64 or parameter lengths");
  }
  const decipher = createDecipheriv("aes-256-gcm", secret, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
