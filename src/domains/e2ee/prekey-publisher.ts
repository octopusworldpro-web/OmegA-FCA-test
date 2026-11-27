import { randomUUID } from "node:crypto";
import type { SignalE2EERuntime } from "./runtime";

type IQResponse = { tag?: string; attrs?: Record<string, string>; content?: unknown };
export type FacebookE2EESendIQ = (stanza: Buffer, id: string) => Promise<IQResponse>;

const TOKEN = {
  ListEmpty: 0,
  JIDPair: 250,
  List8: 248,
  Binary8: 252
} as const;

function encodeBytes(value: Uint8Array): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length > 255) throw new RangeError("Messenger binary node field exceeds 255 bytes");
  return Buffer.concat([Buffer.from([TOKEN.Binary8, bytes.length]), bytes]);
}

function encodeString(value: string): Buffer {
  return encodeBytes(Buffer.from(value, "utf8"));
}

function encodeJid(value: string): Buffer {
  const at = value.indexOf("@");
  if (at <= 0) return encodeString(value);
  const user = value.slice(0, at);
  const server = value.slice(at + 1);
  return Buffer.concat([Buffer.from([TOKEN.JIDPair]), encodeString(user), encodeString(server)]);
}

function encodeListStart(size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < 0 || size > 255) throw new RangeError("Invalid Messenger node list size");
  return size === 0 ? Buffer.from([TOKEN.ListEmpty]) : Buffer.from([TOKEN.List8, size]);
}

function encodeNode(tag: string, attrs: Record<string, string> = {}, children?: Buffer | Buffer[]): Buffer {
  const hasContent = children !== undefined;
  const entries = Object.entries(attrs);
  const size = 1 + entries.length * 2 + (hasContent ? 1 : 0);
  const parts: Buffer[] = [encodeListStart(size), encodeString(tag)];
  for (const [key, value] of entries) {
    parts.push(encodeString(key));
    parts.push(key === "to" || key === "from" || key === "jid" ? encodeJid(value) : encodeString(value));
  }
  if (hasContent) {
    if (Array.isArray(children)) parts.push(Buffer.concat([encodeListStart(children.length), ...children]));
    else parts.push(encodeBytes(children));
  }
  return Buffer.concat(parts);
}

function marshal(node: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0]), node]);
}

function rawSignalPublicKey(value: string, label: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length === 33 && key[0] === 0x05) return key.subarray(1);
  if (key.length === 32) return key;
  throw new Error(`${label} has an unexpected libsignal public-key encoding`);
}

function keyNode(tag: "key" | "skey", id: number, publicKey: string, signature?: string): Buffer {
  if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffff) throw new RangeError("Messenger prekey ID must fit in 3 bytes");
  const idBytes = Buffer.alloc(3);
  idBytes.writeUIntBE(id, 0, 3);
  const children = [
    encodeNode("id", {}, idBytes),
    encodeNode("value", {}, rawSignalPublicKey(publicKey, `${tag} public key`))
  ];
  if (signature) children.push(encodeNode("signature", {}, Buffer.from(signature, "base64")));
  return encodeNode(tag, {}, children);
}

/** Builds the Messenger encrypt IQ containing a signed prekey and one-time Curve25519 prekeys. */
export function buildFacebookPreKeyUpload(runtime: SignalE2EERuntime, id = `pk-${randomUUID()}`): Buffer {
  if (!Number.isSafeInteger(runtime.registrationId) || runtime.registrationId < 1 || runtime.registrationId > 0xffffffff) {
    throw new RangeError("Signal registration ID must be a positive uint32");
  }
  const identity = rawSignalPublicKey(runtime.identityKey, "identity public key");
  const signedPublic = rawSignalPublicKey(runtime.signedPreKey.publicKey, "signed prekey public key");
  const signedSignature = Buffer.from(runtime.signedPreKey.signature, "base64");
  if (identity.length !== 32 || signedPublic.length !== 32 || signedSignature.length !== 64) {
    throw new Error("Signal identity/signed-prekey bundle has an unexpected libsignal encoding");
  }
  const registration = Buffer.alloc(4);
  registration.writeUInt32BE(runtime.registrationId);
  const children = [
    encodeNode("registration", {}, registration),
    encodeNode("type", {}, Buffer.from([0x05])),
    encodeNode("identity", {}, identity),
    encodeNode("list", {}, runtime.preKeys.map((key) => keyNode("key", key.keyId, key.publicKey))),
    keyNode("skey", runtime.signedPreKey.keyId, runtime.signedPreKey.publicKey, runtime.signedPreKey.signature)
  ];
  return marshal(encodeNode("iq", {
    id,
    to: "s.whatsapp.net",
    type: "set",
    xmlns: "encrypt"
  }, children));
}

/** Sends the prekey IQ over an already authenticated Messenger Noise socket and requires an IQ result acknowledgement. */
export async function publishFacebookPreKeys(
  runtime: SignalE2EERuntime,
  sendIQ: FacebookE2EESendIQ
): Promise<{ id: string; uploaded: number; skipped?: boolean }> {
  if (typeof sendIQ !== "function") throw new TypeError("An authenticated Messenger Noise sendIQ transport is required");

  // A persisted IQ result is the only event that marks keys as published.
  // On restart, never resend the full local key store: only unacknowledged
  // one-time keys are eligible for upload.
  const unpublishedIds = runtime.store.listUnpublishedPreKeyIds();
  const unpublishedSet = new Set(unpublishedIds);
  const pendingPreKeys = runtime.preKeys.filter((key) => unpublishedSet.has(key.keyId));
  const signedPreKeyPending = !runtime.store.isSignedPreKeyPublished(runtime.signedPreKey.keyId);
  if (pendingPreKeys.length === 0 && !signedPreKeyPending) {
    return { id: "", uploaded: 0, skipped: true };
  }

  const id = `pk-${randomUUID()}`;
  const uploadRuntime = { ...runtime, preKeys: pendingPreKeys };
  const response = await sendIQ(buildFacebookPreKeyUpload(uploadRuntime, id), id);
  if (!response || response.tag !== "iq" || response.attrs?.id !== id || response.attrs?.type !== "result") {
    const reason = response?.attrs?.type || "missing/invalid IQ result";
    throw new Error(`Messenger rejected or did not acknowledge prekey publication: ${reason}`);
  }

  const acknowledgedAt = Date.now();
  await runtime.store.markPreKeysPublished(unpublishedIds, acknowledgedAt);
  await runtime.store.markSignedPreKeyPublished(runtime.signedPreKey.keyId, acknowledgedAt);
  return { id, uploaded: pendingPreKeys.length };
}
