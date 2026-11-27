import { createHash, randomUUID } from "node:crypto";
import type { SignalKeyStore } from "./signal-key-store";

type Dynamic = any;

/** Unofficial Messenger ICDC application ID used by the audited reference implementation. */
export const FACEBOOK_E2EE_APP_ID = "256002347743983";
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FacebookE2EERegistrationOptions {
  fbid: string;
  fbCat: string;
  appId: string;
  cookies: string;
  userAgent: string;
  signal: Dynamic;
  store: SignalKeyStore;
  deviceId?: string;
  signedPreKeyId: number;
  fetch?: FetchLike;
  now?: () => number;
  /** Explicitly re-register an existing device only when recovery requires it. */
  force?: boolean;
}

export interface FacebookE2EERegistrationResult {
  deviceId: string;
  waDeviceId: number;
  registrationId: number;
  signedPreKeyId: number;
  icdcSequence: number;
}

function varint(value: number | bigint): Buffer {
  let n = BigInt(value);
  if (n < 0n) throw new RangeError("protobuf varint cannot be negative");
  const out: number[] = [];
  while (n > 0x7fn) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}

function fieldVarint(field: number, value: number | bigint): Buffer {
  return Buffer.concat([varint(BigInt(field * 8)), varint(value)]);
}

function fieldBytes(field: number, value: Uint8Array): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(BigInt(field * 8 + 2)), varint(bytes.length), bytes]);
}

function encodeIdentityList(seq: number, timestamp: number, identities: Buffer[], signingIndex: number): Buffer {
  return Buffer.concat([
    fieldVarint(1, seq),
    fieldVarint(2, timestamp),
    ...identities.map((identity) => fieldBytes(3, identity)),
    fieldVarint(4, signingIndex)
  ]);
}

function encodeSignedIdentityList(details: Buffer, signature: Buffer): Buffer {
  return Buffer.concat([fieldBytes(1, details), fieldBytes(2, signature)]);
}

function rawPublicKey(serialized: Uint8Array): Buffer {
  const bytes = Buffer.from(serialized);
  if (bytes.length === 33 && bytes[0] === 0x05) return bytes.subarray(1);
  if (bytes.length === 32) return bytes;
  throw new Error("Unexpected libsignal public key encoding");
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

async function postForm<T>(
  fetcher: FetchLike,
  endpoint: string,
  form: URLSearchParams,
  options: FacebookE2EERegistrationOptions
): Promise<T> {
  const response = await fetcher(`https://reg-e2ee.facebook.com/v2/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": options.userAgent,
      "Origin": "https://www.messenger.com",
      "Referer": "https://www.messenger.com/messages/",
      "Cookie": options.cookies,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site"
    },
    body: form.toString()
  });
  if (!response.ok) throw new Error(`Facebook E2EE ${endpoint} failed: HTTP ${response.status}`);
  return await response.json() as T;
}

/**
 * Registers a libsignal identity as a Messenger E2EE device using Facebook ICDC.
 * The caller must persist deviceId alongside this account's SignalKeyStore and reuse it.
 */
export async function registerFacebookE2EEDevice(
  options: FacebookE2EERegistrationOptions
): Promise<FacebookE2EERegistrationResult> {
  const fbid = requiredText(options?.fbid, "fbid");
  const fbCat = requiredText(options?.fbCat, "fbCat");
  const appId = requiredText(options?.appId, "appId");
  requiredText(options?.cookies, "cookies");
  requiredText(options?.userAgent, "userAgent");
  if (!options.signal?.PrivateKey || !options.store) throw new TypeError("libsignal and SignalKeyStore are required");

  const fetcher = options.fetch || fetch;
  const existingDevice = options.store.getDeviceRecord();
  const registrationId = options.store.getRegistrationId();
  const identity = options.store.getIdentityKeyPair();
  if (!registrationId || !identity) throw new Error("Signal identity and registration ID must be initialized first");

  if (existingDevice && !options.force && (!options.deviceId || options.deviceId === existingDevice.deviceId)) {
    return {
      deviceId: existingDevice.deviceId,
      waDeviceId: existingDevice.waDeviceId,
      registrationId,
      signedPreKeyId: options.signedPreKeyId,
      icdcSequence: existingDevice.icdcSequence
    };
  }
  const deviceId = options.deviceId || existingDevice?.deviceId || randomUUID();

  if (!Number.isSafeInteger(options.signedPreKeyId) || options.signedPreKeyId < 0) {
    throw new TypeError("signedPreKeyId must be a non-negative integer");
  }
  const availableSigned = options.store.loadSignedPreKey(options.signedPreKeyId) || (() => {
    throw new Error("A persisted signed prekey is required before Facebook device registration");
  })();

  const identityPublic = rawPublicKey(Buffer.from(identity.publicKey, "base64"));
  const signedPublic = rawPublicKey(Buffer.from(availableSigned.publicKey, "base64"));
  const fetchForm = new URLSearchParams({
    fbid, device_id: deviceId, app_id: appId, fb_cat: fbCat
  });
  const fetched = await postForm<{
    device_identities?: string[];
    icdc_seq?: number;
    status?: number;
  }>(fetcher, "fb_icdc_fetch", fetchForm, options);

  if (fetched.status !== 200 || !Array.isArray(fetched.device_identities) ||
      !Number.isSafeInteger(fetched.icdc_seq) || Number(fetched.icdc_seq) < 0) {
    throw new Error("Facebook returned an invalid ICDC device list");
  }

  const identities: Buffer[] = fetched.device_identities.map((value) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
      throw new Error("Facebook returned a malformed ICDC identity");
    }
    // Facebook may serialize the 32-byte ICDC identity as padded base64 or
    // unpadded base64url. Normalize only the alphabet/padding; never accept
    // malformed or non-32-byte public keys.
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== normalized) {
      throw new Error("Facebook returned an invalid ICDC identity key");
    }
    return decoded;
  });
  let signingIndex = identities.findIndex((value) => value.equals(identityPublic));
  let sequence = Number(fetched.icdc_seq);
  if (signingIndex < 0) {
    signingIndex = identities.length;
    identities.push(identityPublic);
    sequence += 1;
  }

  const timestamp = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  const details = encodeIdentityList(sequence, timestamp, identities, signingIndex);
  const privateKey = options.signal.PrivateKey.deserialize(Buffer.from(identity.privateKey, "base64"));
  // Buffer.alloc creates an owned ArrayBuffer; narrow the Node Buffer generic for libsignal's signing API.
  const signingInput = Buffer.alloc(details.length) as Buffer<ArrayBuffer>;
  details.copy(signingInput);
  const signature = Buffer.from(privateKey.sign(signingInput));
  const signedList = encodeSignedIdentityList(details, signature);
  const identityHash = createHash("sha256")
    .update(Buffer.concat([...identities].sort(Buffer.compare)))
    .digest().subarray(0, 10);

  const regId = Buffer.alloc(4);
  regId.writeUInt32BE(registrationId);
  const signedId = Buffer.alloc(4);
  signedId.writeUInt32BE(availableSigned.keyId);
  const form = new URLSearchParams({
    fbid,
    fb_cat: fbCat,
    app_id: appId,
    device_id: deviceId,
    e_regid: regId.toString("base64"),
    e_keytype: Buffer.from([0x05]).toString("base64"),
    e_ident: identityPublic.toString("base64"),
    e_skey_id: signedId.subarray(1).toString("base64"),
    e_skey_val: signedPublic.toString("base64"),
    e_skey_sig: Buffer.from(availableSigned.signature, "base64").toString("base64"),
    icdc_list: signedList.toString("base64"),
    icdc_ts: String(timestamp),
    icdc_seq: String(sequence),
    ihash: identityHash.toString("base64")
  });
  const registered = await postForm<{ status?: number; wa_device_id?: number }>(
    fetcher, "fb_register_v2", form, options
  );
  if (registered.status !== 200 || !Number.isSafeInteger(registered.wa_device_id) ||
      Number(registered.wa_device_id) < 1) {
    throw new Error("Facebook rejected E2EE device registration or returned an invalid device ID");
  }
  const result = {
    deviceId,
    waDeviceId: Number(registered.wa_device_id),
    registrationId,
    signedPreKeyId: availableSigned.keyId,
    icdcSequence: sequence
  };
  await options.store.setDeviceRecord({
    deviceId,
    waDeviceId: result.waDeviceId,
    registeredAt: timestamp,
    icdcSequence: sequence
  });
  return result;
}
