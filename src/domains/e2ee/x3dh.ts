import { timingSafeEqual } from "node:crypto";
import {
  deriveOmegAX25519,
  deriveOmegAHKDF,
  generateOmegAX25519KeyPair,
  type OmegAKeyPair
} from "./native-crypto";

const X25519_DOMAIN_PREFIX = Buffer.alloc(32, 0xff);
const HASH_BYTES = 32;

export interface OmegAX3DHPreKeyBundle {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  oneTimePreKey?: Uint8Array;
  signedPreKeyId: number;
  oneTimePreKeyId?: number;
  /** Exact protocol-specific X3DH info string, configured by the integrating protocol. */
  info: string;
}
export interface OmegAX3DHInitiatorOptions {
  identityKeyPair: OmegAKeyPair;
  bundle: OmegAX3DHPreKeyBundle;
  /** Must perform the protocol's real XEdDSA verification; false or throw aborts. */
  verifySignedPreKey: (identityPublicKey: Buffer, signedPreKey: Buffer, signature: Buffer) => boolean;
}
export interface OmegAX3DHInitialMessage {
  identityKey: string;
  ephemeralKey: string;
  signedPreKeyId: number;
  oneTimePreKeyId?: number;
  associatedData: string;
}
export interface OmegAX3DHInitiatorResult {
  sharedSecret: Buffer;
  initialMessage: OmegAX3DHInitialMessage;
}
export interface OmegAX3DHResponderOptions {
  identityKeyPair: OmegAKeyPair;
  signedPreKeyPair: OmegAKeyPair;
  oneTimePreKeyPair?: OmegAKeyPair;
  initialMessage: OmegAX3DHInitialMessage;
  info: string;
}

function key32(value: Uint8Array, label: string): Buffer {
  const result = Buffer.from(value);
  if (result.length !== 32) throw new TypeError(label + " must be exactly 32 bytes");
  return result;
}
function decodeBase64(value: string, label: string): Buffer {
  if (typeof value !== "string") throw new TypeError(label + " must be base64 text");
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) throw new TypeError(label + " contains invalid base64");
  return decoded;
}
function validId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " must be a non-negative safe integer");
}
function deriveSecret(parts: Buffer[], info: string): Buffer {
  if (typeof info !== "string" || !info.length) throw new TypeError("X3DH info is required");
  const material = Buffer.concat([X25519_DOMAIN_PREFIX, ...parts]);
  try {
    return deriveOmegAHKDF(material, Buffer.alloc(HASH_BYTES), info, HASH_BYTES);
  } finally {
    material.fill(0);
    for (const part of parts) part.fill(0);
  }
}
function associatedData(aliceIdentity: Buffer, bobIdentity: Buffer): Buffer {
  // X3DH encodes both 32-byte X25519 public keys in their raw RFC 7748 form.
  return Buffer.concat([aliceIdentity, bobIdentity]);
}

/**
 * X3DH's classical X25519 key-agreement core. Signed-prekey verification is mandatory
 * and deliberately delegated to a protocol-provided XEdDSA verifier; this module does
 * not pretend Ed25519 signatures are interchangeable with XEdDSA.
 */
export function initiateOmegAX3DH(options: OmegAX3DHInitiatorOptions): OmegAX3DHInitiatorResult {
  if (!options || typeof options.verifySignedPreKey !== "function") {
    throw new TypeError("A real XEdDSA signed-prekey verifier is required");
  }
  const bundle = options.bundle;
  if (!bundle) throw new TypeError("X3DH prekey bundle is required");
  validId(bundle.signedPreKeyId, "signedPreKeyId");
  if (bundle.oneTimePreKey !== undefined) validId(bundle.oneTimePreKeyId!, "oneTimePreKeyId");
  const aliceIdentityPublic = key32(options.identityKeyPair.publicKey, "identityKeyPair.publicKey");
  const aliceIdentityPrivate = key32(options.identityKeyPair.privateKey, "identityKeyPair.privateKey");
  const bobIdentity = key32(bundle.identityKey, "bundle.identityKey");
  const bobSignedPreKey = key32(bundle.signedPreKey, "bundle.signedPreKey");
  const signature = Buffer.from(bundle.signedPreKeySignature);
  if (!signature.length || !options.verifySignedPreKey(bobIdentity, bobSignedPreKey, signature)) {
    throw new Error("X3DH signed-prekey XEdDSA verification failed");
  }

  const ephemeral = generateOmegAX25519KeyPair();
  const dh: Buffer[] = [];
  try {
    dh.push(deriveOmegAX25519(aliceIdentityPrivate, bobSignedPreKey));
    dh.push(deriveOmegAX25519(ephemeral.privateKey, bobIdentity));
    dh.push(deriveOmegAX25519(ephemeral.privateKey, bobSignedPreKey));
    if (bundle.oneTimePreKey !== undefined) {
      dh.push(deriveOmegAX25519(ephemeral.privateKey, key32(bundle.oneTimePreKey, "bundle.oneTimePreKey")));
    }
    const sharedSecret = deriveSecret(dh, bundle.info);
    const ad = associatedData(aliceIdentityPublic, bobIdentity);
    const initialMessage: OmegAX3DHInitialMessage = {
      identityKey: aliceIdentityPublic.toString("base64"),
      ephemeralKey: ephemeral.publicKey.toString("base64"),
      signedPreKeyId: bundle.signedPreKeyId,
      ...(bundle.oneTimePreKey === undefined ? {} : { oneTimePreKeyId: bundle.oneTimePreKeyId }),
      associatedData: ad.toString("base64")
    };
    return { sharedSecret, initialMessage };
  } finally {
    ephemeral.privateKey.fill(0);
    aliceIdentityPrivate.fill(0);
  }
}

/** Responder side of classical X3DH; caller must atomically consume/delete a used OPK. */
export function respondOmegAX3DH(options: OmegAX3DHResponderOptions): Buffer {
  if (!options || !options.initialMessage) throw new TypeError("X3DH initial message is required");
  const message = options.initialMessage;
  validId(message.signedPreKeyId, "initialMessage.signedPreKeyId");
  const bobIdentityPublic = key32(options.identityKeyPair.publicKey, "identityKeyPair.publicKey");
  const bobIdentityPrivate = key32(options.identityKeyPair.privateKey, "identityKeyPair.privateKey");
  const bobSignedPrivate = key32(options.signedPreKeyPair.privateKey, "signedPreKeyPair.privateKey");
  const aliceIdentity = key32(Buffer.from(message.identityKey, "base64"), "initialMessage.identityKey");
  const aliceEphemeral = key32(Buffer.from(message.ephemeralKey, "base64"), "initialMessage.ephemeralKey");
  const expectedAd = associatedData(aliceIdentity, bobIdentityPublic);
  const suppliedAd = decodeBase64(message.associatedData, "initialMessage.associatedData");
  if (suppliedAd.length !== expectedAd.length) {
    throw new Error("X3DH associated data is invalid");
  }
  if (!timingSafeEqual(suppliedAd, expectedAd)) throw new Error("X3DH associated data does not match identities");

  const dh: Buffer[] = [];
  try {
    dh.push(deriveOmegAX25519(bobSignedPrivate, aliceIdentity));
    dh.push(deriveOmegAX25519(bobIdentityPrivate, aliceEphemeral));
    dh.push(deriveOmegAX25519(bobSignedPrivate, aliceEphemeral));
    if (message.oneTimePreKeyId !== undefined) {
      validId(message.oneTimePreKeyId, "initialMessage.oneTimePreKeyId");
      if (!options.oneTimePreKeyPair) throw new Error("The referenced X3DH one-time prekey is unavailable");
      dh.push(deriveOmegAX25519(key32(options.oneTimePreKeyPair.privateKey, "oneTimePreKeyPair.privateKey"), aliceEphemeral));
    } else if (options.oneTimePreKeyPair) {
      throw new Error("Unexpected X3DH one-time prekey supplied");
    }
    return deriveSecret(dh, options.info);
  } finally {
    bobIdentityPrivate.fill(0);
    bobSignedPrivate.fill(0);
  }
}
