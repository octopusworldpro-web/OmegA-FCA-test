import { createHmac, randomBytes } from "node:crypto";
import {
  deriveOmegAX25519,
  deriveOmegAHKDF,
  encryptOmegAAes256Gcm,
  decryptOmegAAes256Gcm,
  generateOmegAX25519KeyPair,
  type OmegAAeadCiphertext,
  type OmegAKeyPair
} from "./native-crypto";

const MAX_SKIP = 2000;
const INFO = "DoubleRatchet";

export interface OmegADoubleRatchetHeader {
  dh: string;
  pn: number;
  n: number;
}
export interface OmegADoubleRatchetMessage {
  header: OmegADoubleRatchetHeader;
  body: OmegAAeadCiphertext;
}
export interface OmegADoubleRatchetState {
  rootKey: string;
  localDh: { publicKey: string; privateKey: string };
  remoteDh: string;
  sendChainKey?: string;
  receiveChainKey?: string;
  sendCount: number;
  receiveCount: number;
  previousSendCount: number;
  skippedMessageKeys: Record<string, string>;
}
export interface OmegADoubleRatchetOptions {
  rootKey: Uint8Array;
  localDh: OmegAKeyPair;
  remoteDh: Uint8Array;
  sendChainKey?: Uint8Array;
  receiveChainKey?: Uint8Array;
}

function key32(value: string | Uint8Array, label: string): Buffer {
  const result = typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
  if (result.length !== 32) throw new TypeError(label + " must be 32 bytes");
  return result;
}
function hmac(key: Uint8Array, value: number): Buffer {
  return createHmac("sha256", Buffer.from(key)).update(Buffer.from([value])).digest();
}
function chainStep(chainKey: Uint8Array): { next: Buffer; message: Buffer } {
  return { message: hmac(chainKey, 1), next: hmac(chainKey, 2) };
}
function rootStep(rootKey: Uint8Array, dhOutput: Uint8Array): { root: Buffer; chain: Buffer } {
  const output = deriveOmegAHKDF(dhOutput, rootKey, INFO, 64);
  return { root: output.subarray(0, 32), chain: output.subarray(32, 64) };
}
function skippedId(dh: string, n: number): string { return dh + ":" + n; }
function validateCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " must be a non-negative safe integer");
}
function headerBytes(header: OmegADoubleRatchetHeader): Buffer {
  return Buffer.from(JSON.stringify(header), "utf8");
}

export function createOmegADoubleRatchet(options: OmegADoubleRatchetOptions) {
  if (!options || !options.localDh || !options.rootKey || !options.remoteDh) {
    throw new TypeError("Double Ratchet requires root, local DH and remote DH keys");
  }
  const root = key32(options.rootKey, "rootKey");
  const remote = key32(options.remoteDh, "remoteDh");
  const localPublic = key32(options.localDh.publicKey, "localDh.publicKey");
  const localPrivate = key32(options.localDh.privateKey, "localDh.privateKey");
  const state: OmegADoubleRatchetState = {
    rootKey: root.toString("base64"),
    localDh: { publicKey: localPublic.toString("base64"), privateKey: localPrivate.toString("base64") },
    remoteDh: remote.toString("base64"),
    sendChainKey: options.sendChainKey ? key32(options.sendChainKey, "sendChainKey").toString("base64") : undefined,
    receiveChainKey: options.receiveChainKey ? key32(options.receiveChainKey, "receiveChainKey").toString("base64") : undefined,
    sendCount: 0, receiveCount: 0, previousSendCount: 0, skippedMessageKeys: {}
  };

  function skipUntil(until: number): void {
    validateCount(until, "message number");
    if (until - state.receiveCount > MAX_SKIP) throw new Error("Too many skipped messages");
    if (!state.receiveChainKey && until > state.receiveCount) throw new Error("Receive chain is not initialized");
    while (state.receiveCount < until) {
      const step = chainStep(key32(state.receiveChainKey!, "receiveChainKey"));
      state.receiveChainKey = step.next.toString("base64");
      state.skippedMessageKeys[skippedId(state.remoteDh, state.receiveCount)] = step.message.toString("base64");
      if (Object.keys(state.skippedMessageKeys).length > MAX_SKIP) {
        throw new Error("Skipped message key limit exceeded");
      }
      state.receiveCount++;
    }
  }
  function dhRatchet(remotePublic: Buffer): void {
    state.previousSendCount = state.sendCount;
    state.sendCount = 0;
    state.receiveCount = 0;
    state.remoteDh = remotePublic.toString("base64");
    let step = rootStep(key32(state.rootKey, "rootKey"),
      deriveOmegAX25519(key32(state.localDh.privateKey, "local private key"), remotePublic));
    state.rootKey = step.root.toString("base64");
    state.receiveChainKey = step.chain.toString("base64");
    const nextLocal = generateOmegAX25519KeyPair();
    state.localDh = {
      publicKey: nextLocal.publicKey.toString("base64"),
      privateKey: nextLocal.privateKey.toString("base64")
    };
    step = rootStep(key32(state.rootKey, "rootKey"),
      deriveOmegAX25519(nextLocal.privateKey, remotePublic));
    state.rootKey = step.root.toString("base64");
    state.sendChainKey = step.chain.toString("base64");
  }
  function takeSkipped(header: OmegADoubleRatchetHeader): Buffer | undefined {
    const id = skippedId(header.dh, header.n);
    const encoded = state.skippedMessageKeys[id];
    if (!encoded) return undefined;
    delete state.skippedMessageKeys[id];
    return key32(encoded, "skipped message key");
  }

  return {
    state,
    encrypt(plaintext: Uint8Array, associatedData: Uint8Array = Buffer.alloc(0)): OmegADoubleRatchetMessage {
      if (!(plaintext instanceof Uint8Array)) throw new TypeError("plaintext must be bytes");
      if (!state.sendChainKey) throw new Error("Send chain is not initialized");
      const header = { dh: state.localDh.publicKey, pn: state.previousSendCount, n: state.sendCount };
      const step = chainStep(key32(state.sendChainKey, "sendChainKey"));
      state.sendChainKey = step.next.toString("base64");
      state.sendCount++;
      const aad = Buffer.concat([Buffer.from(associatedData), headerBytes(header)]);
      return { header, body: encryptOmegAAes256Gcm(step.message, plaintext, aad) };
    },
    decrypt(message: OmegADoubleRatchetMessage, associatedData: Uint8Array = Buffer.alloc(0)): Buffer {
      // Ratchet state is security-critical: failed authentication must not consume keys
      // or advance counters. Apply changes transactionally and roll back on any error.
      const before = structuredClone(state);
      try {
        if (!message?.header || typeof message.header.dh !== "string" ||
            !message.body || typeof message.body.ciphertext !== "string" ||
            typeof message.body.nonce !== "string" || typeof message.body.tag !== "string") {
          throw new TypeError("Invalid Double Ratchet message");
        }
        validateCount(message.header.n, "header.n");
        validateCount(message.header.pn, "header.pn");
        const remotePublic = key32(message.header.dh, "header.dh");
        const aad = Buffer.concat([Buffer.from(associatedData), headerBytes(message.header)]);
        const skipped = takeSkipped(message.header);
        if (skipped) return decryptOmegAAes256Gcm(skipped, message.body, aad);
        if (message.header.dh !== state.remoteDh) {
          skipUntil(message.header.pn);
          dhRatchet(remotePublic);
        }
        skipUntil(message.header.n);
        if (!state.receiveChainKey) throw new Error("Receive chain is not initialized");
        const step = chainStep(key32(state.receiveChainKey, "receiveChainKey"));
        const plaintext = decryptOmegAAes256Gcm(step.message, message.body, aad);
        state.receiveChainKey = step.next.toString("base64");
        state.receiveCount++;
        return plaintext;
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    exportState(): OmegADoubleRatchetState { return structuredClone(state); }
  };
}

/** Restore only a state previously exported by this implementation; validate all key fields. */
export function restoreOmegADoubleRatchet(state: OmegADoubleRatchetState) {
  if (!state || !state.localDh || !state.skippedMessageKeys ||
      typeof state.skippedMessageKeys !== "object") {
    throw new TypeError("Invalid Double Ratchet state");
  }
  for (const [label, value] of [
    ["sendCount", state.sendCount],
    ["receiveCount", state.receiveCount],
    ["previousSendCount", state.previousSendCount]
  ] as const) validateCount(value, label);

  const restored = createOmegADoubleRatchet({
    rootKey: key32(state.rootKey, "rootKey"),
    localDh: {
      publicKey: key32(state.localDh.publicKey, "localDh.publicKey"),
      privateKey: key32(state.localDh.privateKey, "localDh.privateKey")
    },
    remoteDh: key32(state.remoteDh, "remoteDh"),
    sendChainKey: state.sendChainKey ? key32(state.sendChainKey, "sendChainKey") : undefined,
    receiveChainKey: state.receiveChainKey ? key32(state.receiveChainKey, "receiveChainKey") : undefined
  });
  Object.assign(restored.state, structuredClone(state));
  return restored;
}
