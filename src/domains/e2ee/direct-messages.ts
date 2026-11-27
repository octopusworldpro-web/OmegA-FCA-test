import type { SignalKeyStore } from "./signal-key-store";
import { createLibsignalStores } from "./libsignal-adapter";

type Dynamic = any;

export interface SignalPeerAddress { name: string; deviceId: number; }
export interface SignalCiphertext { type: number; body: string; }
export interface SignalDirectMessageDeps {
  signal: Dynamic;
  stores: {
    sessionStore: Dynamic;
    identityKeyStore: Dynamic;
    preKeyStore: Dynamic;
    signedPreKeyStore: Dynamic;
    kyberPreKeyStore: Dynamic;
  };
  localAddress: SignalPeerAddress;
}

function validateAddress(value: SignalPeerAddress, label: string): SignalPeerAddress {
  if (!value || typeof value.name !== "string" || !value.name.trim() ||
      !Number.isSafeInteger(value.deviceId) || value.deviceId < 1) {
    throw new TypeError(`${label} requires a non-empty name and positive deviceId`);
  }
  return { name: value.name.trim(), deviceId: value.deviceId };
}

function makeAddress(signal: Dynamic, value: SignalPeerAddress, label: string): Dynamic {
  const address = validateAddress(value, label);
  if (typeof signal?.ProtocolAddress?.new !== "function") {
    throw new TypeError("A compatible libsignal ProtocolAddress implementation is required");
  }
  return signal.ProtocolAddress.new(address.name, address.deviceId);
}

function requireDeps(deps: SignalDirectMessageDeps): void {
  if (!deps?.signal || !deps.stores?.sessionStore || !deps.stores?.identityKeyStore ||
      !deps.stores?.preKeyStore || !deps.stores?.signedPreKeyStore || !deps.stores?.kyberPreKeyStore) {
    throw new TypeError("Signal module and all five libsignal stores are required");
  }
}

function bytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return value;
  throw new TypeError("message must be a string or Uint8Array");
}

/** Establishes an outgoing 1:1 session from a server-fetched, libsignal-native PreKeyBundle. */
export async function establishSignalDirectSession(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  preKeyBundle: Dynamic,
  now = new Date()
): Promise<void> {
  requireDeps(deps);
  if (!preKeyBundle || typeof preKeyBundle !== "object") throw new TypeError("preKeyBundle is required");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
  const address = makeAddress(deps.signal, remote, "remote");
  const local = makeAddress(deps.signal, deps.localAddress, "local");
  await deps.signal.processPreKeyBundle(
    preKeyBundle, address, local, deps.stores.sessionStore, deps.stores.identityKeyStore, now
  );
}

/** Encrypts one direct-message plaintext using the established per-device Double Ratchet session. */
export async function encryptSignalDirectMessage(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  plaintext: string | Uint8Array,
  now = new Date()
): Promise<SignalCiphertext> {
  requireDeps(deps);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
  const address = makeAddress(deps.signal, remote, "remote");
  const local = makeAddress(deps.signal, deps.localAddress, "local");
  const encrypted = await deps.signal.signalEncrypt(
    bytes(plaintext), address, local, deps.stores.sessionStore, deps.stores.identityKeyStore, now
  );
  if (!encrypted || typeof encrypted.type !== "function" || typeof encrypted.serialize !== "function") {
    throw new Error("libsignal returned an invalid ciphertext message");
  }
  return { type: encrypted.type(), body: Buffer.from(encrypted.serialize()).toString("base64") };
}

/** Decrypts a peer ciphertext. PreKey messages create the inbound session and consume their one-time key. */
export async function decryptSignalDirectMessage(
  deps: SignalDirectMessageDeps,
  remote: SignalPeerAddress,
  ciphertext: SignalCiphertext
): Promise<Uint8Array> {
  requireDeps(deps);
  if (!ciphertext || !Number.isSafeInteger(ciphertext.type) || typeof ciphertext.body !== "string" || !ciphertext.body.trim()) {
    throw new TypeError("ciphertext requires an integer type and base64 body");
  }
  const encoded = Buffer.from(ciphertext.body, "base64");
  if (!encoded.length || encoded.toString("base64").replace(/=+$/, "") !== ciphertext.body.replace(/=+$/, "")) {
    throw new TypeError("ciphertext.body must be valid base64");
  }
  const address = makeAddress(deps.signal, remote, "remote");
  const local = makeAddress(deps.signal, deps.localAddress, "local");
  let plaintext: Uint8Array;
  if (ciphertext.type === deps.signal.CiphertextMessageType?.PreKey) {
    const message = deps.signal.PreKeySignalMessage.deserialize(encoded);
    plaintext = await deps.signal.signalDecryptPreKey(
      message, address, local,
      deps.stores.sessionStore, deps.stores.identityKeyStore,
      deps.stores.preKeyStore, deps.stores.signedPreKeyStore, deps.stores.kyberPreKeyStore
    );
  } else if (ciphertext.type === deps.signal.CiphertextMessageType?.Whisper) {
    const message = deps.signal.SignalMessage.deserialize(encoded);
    plaintext = await deps.signal.signalDecrypt(
      message, address, local, deps.stores.sessionStore, deps.stores.identityKeyStore
    );
  } else {
    throw new TypeError(`Unsupported direct-message ciphertext type: ${ciphertext.type}`);
  }
  return Uint8Array.from(plaintext);
}

/** Utility to build the five native store adapters and direct-message operations together. */
export function createSignalDirectMessages(signal: Dynamic, keyStore: SignalKeyStore, localAddress: SignalPeerAddress) {
  const stores = createLibsignalStores(signal, keyStore);
  const deps: SignalDirectMessageDeps = { signal, stores, localAddress: validateAddress(localAddress, "local") };
  return {
    stores,
    setLocalAddress(address: SignalPeerAddress) { deps.localAddress = validateAddress(address, "local"); },
    establishSession: (remote: SignalPeerAddress, bundle: Dynamic, now?: Date) => establishSignalDirectSession(deps, remote, bundle, now),
    encrypt: (remote: SignalPeerAddress, plaintext: string | Uint8Array, now?: Date) => encryptSignalDirectMessage(deps, remote, plaintext, now),
    decrypt: (remote: SignalPeerAddress, ciphertext: SignalCiphertext) => decryptSignalDirectMessage(deps, remote, ciphertext)
  };
}
