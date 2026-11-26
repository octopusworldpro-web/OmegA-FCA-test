import { createHash, hkdfSync, timingSafeEqual } from "node:crypto";
import { deriveOmegAX25519, generateOmegAX25519KeyPair, type OmegAKeyPair } from "./native-crypto";
import { verifyOmegAXEdDSA } from "./xeddsa";

const F = Buffer.alloc(32, 0xff);
const LEN = 32;

export interface OmegAPQKEM {
  /** Exact parameter name used in the PQXDH info string (e.g. CRYSTALS-KYBER-1024). */
  readonly parameter: string;
  encapsulate(publicKey: Uint8Array): { ciphertext: Uint8Array; sharedSecret: Uint8Array };
  decapsulate(privateKey: Uint8Array, ciphertext: Uint8Array): Uint8Array;
  /** Canonical EncodeKEM representation that is signed by the XEdDSA identity key. */
  encodePublicKey(publicKey: Uint8Array): Uint8Array;
}
export interface OmegAPQXDHBundle {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  kemPublicKey: Uint8Array;
  kemPublicKeySignature: Uint8Array;
  kemKeyId: number;
  signedPreKeyId: number;
  oneTimePreKey?: Uint8Array;
  oneTimePreKeyId?: number;
  protocol: string;
}
export interface OmegAPQXDHInitialMessage {
  identityKey: string;
  ephemeralKey: string;
  signedPreKeyId: number;
  kemKeyId: number;
  kemCiphertext: string;
  oneTimePreKeyId?: number;
  associatedData: string;
}
export interface OmegAPQXDHInitiatorOptions {
  identityKeyPair: OmegAKeyPair;
  bundle: OmegAPQXDHBundle;
  kem: OmegAPQKEM;
  verifySignature?: (identityKey: Buffer, message: Buffer, signature: Buffer) => boolean;
}
export interface OmegAPQXDHResponderOptions {
  identityKeyPair: OmegAKeyPair;
  signedPreKeyPair: OmegAKeyPair;
  kemPrivateKey: Uint8Array;
  initialMessage: OmegAPQXDHInitialMessage;
  kem: OmegAPQKEM;
  protocol: string;
  oneTimePreKeyPair?: OmegAKeyPair;
}
export interface OmegAPQXDHResult {
  sharedSecret: Buffer;
  initialMessage: OmegAPQXDHInitialMessage;
}
function key32(value: Uint8Array, label: string): Buffer {
  const out = Buffer.from(value);
  if (out.length !== 32) throw new TypeError(label + " must be exactly 32 bytes");
  return out;
}
function id(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " must be a non-negative safe integer");
}
function decode(value: string, label: string): Buffer {
  if (typeof value !== "string") throw new TypeError(label + " must be base64");
  const out = Buffer.from(value, "base64");
  if (out.toString("base64") !== value || !out.length) throw new TypeError(label + " has invalid base64");
  return out;
}
function ad(alice: Buffer, bob: Buffer): Buffer {
  return Buffer.concat([Buffer.from([5]), alice, Buffer.from([5]), bob]);
}
function kdf(dh: Buffer[], kemSecret: Buffer, protocol: string, kemName: string): Buffer {
  if (!protocol || !kemName) throw new TypeError("PQXDH protocol and KEM parameter names are required");
  const info = protocol + "_CURVE25519_SHA-512_" + kemName;
  const ikm = Buffer.concat([F, ...dh, kemSecret]);
  try {
    return Buffer.from(hkdfSync("sha512", ikm, Buffer.alloc(64), info, LEN));
  } finally {
    ikm.fill(0);
    kemSecret.fill(0);
    for (const part of dh) part.fill(0);
  }
}
function signatureVerifier(options: OmegAPQXDHInitiatorOptions) {
  return options.verifySignature || verifyOmegAXEdDSA;
}

/** PQXDH initiator. A real, parameter-matched post-quantum KEM provider is mandatory. */
export function initiateOmegAPQXDH(options: OmegAPQXDHInitiatorOptions): OmegAPQXDHResult {
  if (!options?.kem || typeof options.kem.encapsulate !== "function" ||
      typeof options.kem.encodePublicKey !== "function") throw new TypeError("A compatible PQ KEM provider is required");
  const b = options.bundle;
  if (!b) throw new TypeError("PQXDH prekey bundle is required");
  id(b.signedPreKeyId, "signedPreKeyId"); id(b.kemKeyId, "kemKeyId");
  if (b.oneTimePreKey !== undefined) id(b.oneTimePreKeyId!, "oneTimePreKeyId");
  const aliceIdentity = key32(options.identityKeyPair.publicKey, "identity public key");
  const alicePrivate = key32(options.identityKeyPair.privateKey, "identity private key");
  const bobIdentity = key32(b.identityKey, "bundle identity key");
  const bobSigned = key32(b.signedPreKey, "bundle signed prekey");
  const verify = signatureVerifier(options);
  if (!verify(bobIdentity, bobSigned, Buffer.from(b.signedPreKeySignature))) throw new Error("PQXDH signed curve prekey signature invalid");
  const encodedKem = Buffer.from(options.kem.encodePublicKey(b.kemPublicKey));
  if (!encodedKem.length || !verify(bobIdentity, encodedKem, Buffer.from(b.kemPublicKeySignature))) {
    throw new Error("PQXDH KEM prekey signature invalid");
  }
  const ephemeral = generateOmegAX25519KeyPair();
  const dh: Buffer[] = [];
  try {
    dh.push(deriveOmegAX25519(alicePrivate, bobSigned));
    dh.push(deriveOmegAX25519(ephemeral.privateKey, bobIdentity));
    dh.push(deriveOmegAX25519(ephemeral.privateKey, bobSigned));
    if (b.oneTimePreKey !== undefined) dh.push(deriveOmegAX25519(ephemeral.privateKey, key32(b.oneTimePreKey, "oneTimePreKey")));
    const encapsulated = options.kem.encapsulate(b.kemPublicKey);
    const kemSecret = Buffer.from(encapsulated.sharedSecret);
    if (!kemSecret.length || !Buffer.from(encapsulated.ciphertext).length) throw new Error("PQ KEM returned an empty ciphertext or shared secret");
    const sharedSecret = kdf(dh, kemSecret, b.protocol, options.kem.parameter);
    const associatedData = ad(aliceIdentity, bobIdentity);
    return {
      sharedSecret,
      initialMessage: {
        identityKey: aliceIdentity.toString("base64"),
        ephemeralKey: ephemeral.publicKey.toString("base64"),
        signedPreKeyId: b.signedPreKeyId,
        kemKeyId: b.kemKeyId,
        kemCiphertext: Buffer.from(encapsulated.ciphertext).toString("base64"),
        ...(b.oneTimePreKey === undefined ? {} : { oneTimePreKeyId: b.oneTimePreKeyId }),
        associatedData: associatedData.toString("base64")
      }
    };
  } finally {
    ephemeral.privateKey.fill(0);
    alicePrivate.fill(0);
  }
}

/** PQXDH responder. Caller must atomically consume/delete any one-time EC/KEM prekeys. */
export function respondOmegAPQXDH(options: OmegAPQXDHResponderOptions): Buffer {
  if (!options?.kem || typeof options.kem.decapsulate !== "function") throw new TypeError("A compatible PQ KEM provider is required");
  const m = options.initialMessage;
  if (!m) throw new TypeError("PQXDH initial message is required");
  id(m.signedPreKeyId, "signedPreKeyId"); id(m.kemKeyId, "kemKeyId");
  const bobIdentity = key32(options.identityKeyPair.publicKey, "identity public key");
  const bobPrivate = key32(options.identityKeyPair.privateKey, "identity private key");
  const signedPrivate = key32(options.signedPreKeyPair.privateKey, "signed prekey private key");
  const aliceIdentity = key32(decode(m.identityKey, "identityKey"), "identityKey");
  const aliceEphemeral = key32(decode(m.ephemeralKey, "ephemeralKey"), "ephemeralKey");
  const expectedAd = ad(aliceIdentity, bobIdentity);
  const suppliedAd = decode(m.associatedData, "associatedData");
  if (suppliedAd.length !== expectedAd.length || !timingSafeEqual(suppliedAd, expectedAd)) {
    throw new Error("PQXDH associated data does not match identities");
  }
  const dh: Buffer[] = [];
  try {
    dh.push(deriveOmegAX25519(signedPrivate, aliceIdentity));
    dh.push(deriveOmegAX25519(bobPrivate, aliceEphemeral));
    dh.push(deriveOmegAX25519(signedPrivate, aliceEphemeral));
    if (m.oneTimePreKeyId !== undefined) {
      id(m.oneTimePreKeyId, "oneTimePreKeyId");
      if (!options.oneTimePreKeyPair) throw new Error("Referenced PQXDH one-time EC prekey unavailable");
      dh.push(deriveOmegAX25519(key32(options.oneTimePreKeyPair.privateKey, "one-time EC private key"), aliceEphemeral));
    } else if (options.oneTimePreKeyPair) throw new Error("Unexpected one-time EC prekey supplied");
    const kemSecret = Buffer.from(options.kem.decapsulate(options.kemPrivateKey, decode(m.kemCiphertext, "kemCiphertext")));
    if (!kemSecret.length) throw new Error("PQ KEM decapsulation returned an empty secret");
    return kdf(dh, kemSecret, options.protocol, options.kem.parameter);
  } finally {
    bobPrivate.fill(0);
    signedPrivate.fill(0);
  }
}
