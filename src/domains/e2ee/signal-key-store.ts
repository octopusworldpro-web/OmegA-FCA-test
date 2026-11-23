import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface SignalKeyPairRecord {
  publicKey: string;
  privateKey: string;
}

export interface SignalSignedPreKeyRecord extends SignalKeyPairRecord {
  keyId: number;
  signature: string;
  createdAt: number;
}

export interface SignalDeviceRecord {
  deviceId: string;
  waDeviceId: number;
  registeredAt: number;
  icdcSequence: number;
}

export interface SignalSessionAddress {
  name: string;
  deviceId: number;
}

export interface SignalStoreOptions {
  accountId: string;
  storagePath: string;
  /** Secret used only to encrypt the local store; supply at least 32 bytes. */
  encryptionKey: string | Buffer;
}

interface SignalStoreState {
  version: 1;
  accountId: string;
  identityKeyPair?: SignalKeyPairRecord;
  registrationId?: number;
  signedPreKeys: Record<string, SignalSignedPreKeyRecord>;
  oneTimePreKeys: Record<string, SignalKeyPairRecord>;
  kyberPreKeys: Record<string, string>;
  usedKyberPreKeys: Record<string, string[]>;
  sessions: Record<string, string>;
  trustedIdentities: Record<string, string>;
  senderKeys?: Record<string, string>;
  device?: SignalDeviceRecord;
}

interface EncryptedEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

const emptyState = (accountId: string): SignalStoreState => ({
  version: 1,
  accountId,
  signedPreKeys: {},
  oneTimePreKeys: {},
  kyberPreKeys: {},
  usedKyberPreKeys: {},
  sessions: {},
  trustedIdentities: {},
  senderKeys: {}
});

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireBytes(value: unknown, label: string): string {
  const normalized = requireText(value, label);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new TypeError(`${label} must be base64-encoded bytes`);
  }
  return normalized;
}

function requireId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function addressKey(address: SignalSessionAddress): string {
  const name = requireText(address?.name, "address.name");
  const deviceId = requireId(address?.deviceId, "address.deviceId");
  return `${name}.${deviceId}`;
}

function deriveKey(secret: string | Buffer, salt: Buffer): Buffer {
  const material = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, "utf8");
  if (material.length < 32) {
    throw new TypeError("Signal store encryptionKey must contain at least 32 bytes");
  }
  return scryptSync(material, salt, 32);
}

function encryptState(state: SignalStoreState, secret: string | Buffer): EncryptedEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final()
  ]);
  return {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptState(envelope: EncryptedEnvelope, secret: string | Buffer): SignalStoreState {
  if (envelope?.version !== 1) {
    throw new Error("Unsupported Signal store envelope version");
  }
  const salt = Buffer.from(requireBytes(envelope.salt, "envelope.salt"), "base64");
  const iv = Buffer.from(requireBytes(envelope.iv, "envelope.iv"), "base64");
  const tag = Buffer.from(requireBytes(envelope.tag, "envelope.tag"), "base64");
  const ciphertext = Buffer.from(requireBytes(envelope.ciphertext, "envelope.ciphertext"), "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid Signal store envelope parameters");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  const parsed = JSON.parse(Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8")) as SignalStoreState;
  if (parsed.version !== 1 || typeof parsed.accountId !== "string") {
    throw new Error("Invalid Signal store payload");
  }
  return parsed;
}

export interface SignalKeyStore {
  readonly accountId: string;
  setDeviceRecord(record: SignalDeviceRecord): Promise<void>;
  getDeviceRecord(): SignalDeviceRecord | undefined;
  setIdentityKeyPair(record: SignalKeyPairRecord): Promise<void>;
  getIdentityKeyPair(): SignalKeyPairRecord | undefined;
  setRegistrationId(id: number): Promise<void>;
  getRegistrationId(): number | undefined;
  storeSignedPreKey(record: SignalSignedPreKeyRecord): Promise<void>;
  loadSignedPreKey(keyId: number): SignalSignedPreKeyRecord | undefined;
  listSignedPreKeyIds(): number[];
  removeSignedPreKey(keyId: number): Promise<void>;
  storePreKey(keyId: number, record: SignalKeyPairRecord): Promise<void>;
  loadPreKey(keyId: number): SignalKeyPairRecord | undefined;
  listPreKeyIds(): number[];
  removePreKey(keyId: number): Promise<void>;
  storeKyberPreKey(keyId: number, serializedRecord: string): Promise<void>;
  loadKyberPreKey(keyId: number): string | undefined;
  listKyberPreKeyIds(): number[];
  markKyberPreKeyUsed(keyId: number, signedPreKeyId: number, baseKey: string): Promise<void>;
  hasKyberPreKeyBeenUsed(keyId: number): boolean;
  storeSenderKey(address: SignalSessionAddress, groupId: string, serializedRecord: string): Promise<void>;
  loadSenderKey(address: SignalSessionAddress, groupId: string): string | undefined;
  removeSenderKey(address: SignalSessionAddress, groupId: string): Promise<void>;
  storeSession(address: SignalSessionAddress, serializedRecord: string): Promise<void>;
  loadSession(address: SignalSessionAddress): string | undefined;
  removeSession(address: SignalSessionAddress): Promise<void>;
  isTrustedIdentity(address: SignalSessionAddress, identityKey: string): boolean;
  getIdentity(address: SignalSessionAddress): string | undefined;
  saveIdentity(address: SignalSessionAddress, identityKey: string): Promise<boolean>;
  deleteIdentity(address: SignalSessionAddress): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function createSignalKeyStore(options: SignalStoreOptions): Promise<SignalKeyStore> {
  const accountId = requireText(options?.accountId, "accountId");
  const storagePath = resolve(requireText(options?.storagePath, "storagePath"));
  const secret = options?.encryptionKey;
  if (!Buffer.isBuffer(secret) && typeof secret !== "string") {
    throw new TypeError("encryptionKey must be a string or Buffer");
  }
  deriveKey(secret, Buffer.alloc(16));

  let state = emptyState(accountId);
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as EncryptedEnvelope;
    const loaded = decryptState(parsed, secret);
    if (loaded.accountId !== accountId) {
      throw new Error("Signal store belongs to a different account");
    }
    state = loaded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  const persist = async () => {
    const temporary = `${storagePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });
    const payload = JSON.stringify(encryptState(state, secret));
    try {
      await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, storagePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const mutate = (change: (draft: SignalStoreState) => void): Promise<void> => {
    if (closed) return Promise.reject(new Error("Signal key store is closed"));
    const operation = queue.then(async () => {
      const previous = state;
      const draft = structuredClone(state);
      change(draft);
      state = draft;
      try {
        await persist();
      } catch (error) {
        state = previous;
        throw error;
      }
    });
    queue = operation.catch(() => undefined);
    return operation;
  };

  const snapshot = () => structuredClone(state);
  const store: SignalKeyStore = {
    accountId,
    setDeviceRecord: (record) => mutate((draft) => {
      const deviceId = requireText(record?.deviceId, "device.deviceId");
      const waDeviceId = requireId(record?.waDeviceId, "device.waDeviceId");
      const registeredAt = requireId(record?.registeredAt, "device.registeredAt");
      const icdcSequence = requireId(record?.icdcSequence, "device.icdcSequence");
      if (waDeviceId < 1) throw new TypeError("device.waDeviceId must be positive");
      draft.device = { deviceId, waDeviceId, registeredAt, icdcSequence };
    }),
    getDeviceRecord: () => snapshot().device,
    setIdentityKeyPair: (record) => mutate((draft) => {
      draft.identityKeyPair = {
        publicKey: requireBytes(record?.publicKey, "identity.publicKey"),
        privateKey: requireBytes(record?.privateKey, "identity.privateKey")
      };
    }),
    getIdentityKeyPair: () => snapshot().identityKeyPair,
    setRegistrationId: (id) => mutate((draft) => { draft.registrationId = requireId(id, "registrationId"); }),
    getRegistrationId: () => snapshot().registrationId,
    storeSignedPreKey: (record) => mutate((draft) => {
      const keyId = requireId(record?.keyId, "signedPreKey.keyId");
      draft.signedPreKeys[String(keyId)] = {
        keyId,
        publicKey: requireBytes(record.publicKey, "signedPreKey.publicKey"),
        privateKey: requireBytes(record.privateKey, "signedPreKey.privateKey"),
        signature: requireBytes(record.signature, "signedPreKey.signature"),
        createdAt: requireId(record.createdAt, "signedPreKey.createdAt")
      };
    }),
    loadSignedPreKey: (keyId) => snapshot().signedPreKeys[String(requireId(keyId, "keyId"))],
    listSignedPreKeyIds: () => Object.keys(snapshot().signedPreKeys).map(Number).sort((a, b) => a - b),
    removeSignedPreKey: (keyId) => mutate((draft) => { delete draft.signedPreKeys[String(requireId(keyId, "keyId"))]; }),
    storePreKey: (keyId, record) => mutate((draft) => {
      const id = requireId(keyId, "keyId");
      draft.oneTimePreKeys[String(id)] = {
        publicKey: requireBytes(record?.publicKey, "preKey.publicKey"),
        privateKey: requireBytes(record?.privateKey, "preKey.privateKey")
      };
    }),
    loadPreKey: (keyId) => snapshot().oneTimePreKeys[String(requireId(keyId, "keyId"))],
    listPreKeyIds: () => Object.keys(snapshot().oneTimePreKeys).map(Number).sort((a, b) => a - b),
    removePreKey: (keyId) => mutate((draft) => { delete draft.oneTimePreKeys[String(requireId(keyId, "keyId"))]; }),
    storeKyberPreKey: (keyId, serializedRecord) => mutate((draft) => {
      draft.kyberPreKeys[String(requireId(keyId, "kyberPreKeyId"))] = requireBytes(serializedRecord, "Kyber pre-key record");
    }),
    loadKyberPreKey: (keyId) => snapshot().kyberPreKeys[String(requireId(keyId, "kyberPreKeyId"))],
    listKyberPreKeyIds: () => Object.keys(snapshot().kyberPreKeys).map(Number).sort((a, b) => a - b),
    markKyberPreKeyUsed: (keyId, signedPreKeyId, baseKey) => mutate((draft) => {
      const id = String(requireId(keyId, "kyberPreKeyId"));
      const signedId = requireId(signedPreKeyId, "signedPreKeyId");
      const normalizedBaseKey = requireBytes(baseKey, "baseKey");
      if (!draft.kyberPreKeys[id]) throw new Error(`Kyber pre-key ${id} not found`);
      const existing = draft.usedKyberPreKeys[id] || [];
      if (existing.length > 0) {
        const marker = `${signedId}:${normalizedBaseKey}`;
        if (existing.includes(marker)) throw new Error("Kyber pre-key base key reuse detected");
        throw new Error("Kyber pre-key has already been consumed");
      }
      draft.usedKyberPreKeys[id] = [`${signedId}:${normalizedBaseKey}`];
    }),
    hasKyberPreKeyBeenUsed: (keyId) => Boolean(snapshot().usedKyberPreKeys[String(requireId(keyId, "kyberPreKeyId"))]?.length),
    storeSenderKey: (address, groupId, serializedRecord) => mutate((draft) => {
      const group = requireText(groupId, "groupId");
      draft.senderKeys ||= {};
      draft.senderKeys[`${addressKey(address)}|${group}`] = requireBytes(serializedRecord, "sender key record");
    }),
    loadSenderKey: (address, groupId) => snapshot().senderKeys?.[`${addressKey(address)}|${requireText(groupId, "groupId")}`],
    removeSenderKey: (address, groupId) => mutate((draft) => {
      delete draft.senderKeys?.[`${addressKey(address)}|${requireText(groupId, "groupId")}`];
    }),
    storeSession: (address, serializedRecord) => mutate((draft) => {
      draft.sessions[addressKey(address)] = requireBytes(serializedRecord, "session record");
    }),
    loadSession: (address) => snapshot().sessions[addressKey(address)],
    removeSession: (address) => mutate((draft) => { delete draft.sessions[addressKey(address)]; }),
    isTrustedIdentity: (address, identityKey) => {
      const existing = snapshot().trustedIdentities[addressKey(address)];
      return existing === undefined || existing === requireBytes(identityKey, "identityKey");
    },
    getIdentity: (address) => snapshot().trustedIdentities[addressKey(address)],
    saveIdentity: async (address, identityKey) => {
      const key = addressKey(address);
      const normalized = requireBytes(identityKey, "identityKey");
      const changed = snapshot().trustedIdentities[key] !== normalized;
      await mutate((draft) => { draft.trustedIdentities[key] = normalized; });
      return changed;
    },
    deleteIdentity: (address) => mutate((draft) => { delete draft.trustedIdentities[addressKey(address)]; }),
    flush: async () => { await queue; },
    close: async () => { await queue; closed = true; }
  };

  return store;
}
