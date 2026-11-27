import { createSignalKeyStore, type SignalKeyStore } from "./signal-key-store";
import { generateOmegAX25519KeyPair } from "./native-crypto";
import {
  ensureSignalIdentity,
  createSignalSignedPreKey,
  createSignalPreKeyBatch,
  createSignalKyberPreKeyBatch,
  loadSignalKyberPreKey
} from "./libsignal-adapter";
import { createSignalDirectMessages } from "./direct-messages";
import { createSignalE2EEActions } from "./actions";
import { createSignalSenderKeyGroups } from "./sender-keys";

type Dynamic = any;

export interface SignalRuntimeOptions {
  accountId: string;
  storagePath: string;
  encryptionKey: string | Buffer;
  localDeviceId: number;
  signedPreKeyId?: number;
  /** Number of local one-time EC prekeys to keep available. Defaults to 25. */
  preKeyCount?: number;
  /** Number of optional post-quantum prekeys to create when supported. Defaults to 1. */
  kyberPreKeyCount?: number;
  /** Rotate the current signed prekey after this age. Defaults to 30 days. */
  signedPreKeyRotationMs?: number;
  signal: Dynamic;
}

export interface SignalE2EERuntime {
  store: SignalKeyStore;
  directMessages: ReturnType<typeof createSignalDirectMessages>;
  actions: ReturnType<typeof createSignalE2EEActions>;
  groups: ReturnType<typeof createSignalSenderKeyGroups>;
  /** Active Messenger Signal device ID (updated to the server-assigned ICDC ID after registration). */
  localDeviceId: number;
  setLocalDeviceId(deviceId: number): void;
  /** Stable Signal registration ID persisted for this account. */
  registrationId: number;
  /** Public identity key only; private identity material never leaves the encrypted store. */
  identityKey: string;
  /** Public signed-prekey bundle; private key material remains inside the encrypted store. */
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  /** Public portions only; private key material remains inside the encrypted store. */
  preKeys: Array<{ keyId: number; publicKey: string }>;
  kyberPreKeys: Array<{ keyId: number; publicKey: string; signature: string }>;
  /** Refill the local one-time-prekey pool to the requested target count. */
  replenishPreKeys(targetCount?: number): Promise<Array<{ keyId: number; publicKey: string }>>;
  /** Rotate the signed prekey when its configured age threshold has elapsed. */
  rotateSignedPreKeyIfDue(now?: number): Promise<{ keyId: number; publicKey: string; signature: string }>;
  close(): Promise<void>;
}

/**
 * Creates the opt-in Signal runtime around a compatible Signal implementation.
 * Initializes and persists local identity and prekeys only. Facebook device
 * registration, bundle publication, MQTT envelopes and Messenger wire
 * compatibility remain separate integration stages.
 */
export async function createSignalE2EERuntime(options: SignalRuntimeOptions): Promise<SignalE2EERuntime> {
  if (!options || typeof options.accountId !== "string" || !options.accountId.trim()) {
    throw new TypeError("E2EE accountId is required");
  }
  if (typeof options.storagePath !== "string" || !options.storagePath.trim()) {
    throw new TypeError("E2EE storagePath is required");
  }
  if (!Number.isSafeInteger(options.localDeviceId) || options.localDeviceId < 1) {
    throw new TypeError("E2EE localDeviceId must be a positive safe integer");
  }
  if (!options.signal || typeof options.signal.PrivateKey?.generate !== "function") {
    throw new TypeError("A compatible libsignal module (Signal implementation) must be supplied as signalModule");
  }

  const preKeyCount = options.preKeyCount ?? 25;
  const kyberPreKeyCount = options.kyberPreKeyCount ?? 1;
  if (!Number.isSafeInteger(preKeyCount) || preKeyCount < 0 || preKeyCount > 1000) {
    throw new RangeError("E2EE preKeyCount must be between 0 and 1000");
  }
  if (!Number.isSafeInteger(kyberPreKeyCount) || kyberPreKeyCount < 0 || kyberPreKeyCount > 100) {
    throw new RangeError("E2EE kyberPreKeyCount must be between 0 and 100");
  }
  const signedPreKeyRotationMs = options.signedPreKeyRotationMs ?? 30 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(signedPreKeyRotationMs) || signedPreKeyRotationMs < 1) {
    throw new RangeError("E2EE signedPreKeyRotationMs must be a positive safe integer");
  }

  const store = await createSignalKeyStore({
    accountId: options.accountId.trim(),
    storagePath: options.storagePath,
    encryptionKey: options.encryptionKey
  });

  try {
    await ensureSignalIdentity(options.signal, store);
    // Messenger Noise uses a separate long-lived X25519 static identity. Keep it
    // account-scoped and encrypted at rest; never reuse the Signal identity key.
    if (!store.getNoiseKeyPair()) {
      const noiseKeyPair = generateOmegAX25519KeyPair();
      await store.setNoiseKeyPair({
        publicKey: noiseKeyPair.publicKey.toString("base64"),
        privateKey: noiseKeyPair.privateKey.toString("base64")
      });
    }
    const persistedNoiseKeyPair = store.getNoiseKeyPair();
    if (!persistedNoiseKeyPair) throw new Error("Messenger Noise identity initialization failed");
    const persistedIdentity = store.getIdentityKeyPair();
    const registrationId = store.getRegistrationId();
    if (!persistedIdentity || registrationId === undefined) {
      throw new Error("Signal identity initialization did not persist identity and registration ID");
    }
    const identityKey = persistedIdentity.publicKey;

    const existingSignedPreKeyIds = store.listSignedPreKeyIds();
    // Reuse the current persisted signed prekey by default. Creating a fresh
    // signed prekey on every process restart would churn device bundles and
    // make previously published bundles stale without any rotation policy.
    let currentSignedPreKeyId = options.signedPreKeyId ??
      (existingSignedPreKeyIds.length ? Math.max(...existingSignedPreKeyIds) : 1);
    if (!store.loadSignedPreKey(currentSignedPreKeyId)) {
      await createSignalSignedPreKey(options.signal, store, currentSignedPreKeyId);
    }
    const getSignedPreKey = () => {
      const record = store.loadSignedPreKey(currentSignedPreKeyId);
      if (!record) throw new Error("Persisted signed prekey disappeared after initialization");
      return { keyId: currentSignedPreKeyId, publicKey: record.publicKey, signature: record.signature };
    };
    const initialSignedPreKey = store.loadSignedPreKey(currentSignedPreKeyId);
    if (!initialSignedPreKey) throw new Error("Persisted signed prekey disappeared after initialization");
    if (options.signedPreKeyId === undefined &&
        Date.now() - initialSignedPreKey.createdAt >= signedPreKeyRotationMs) {
      const nextSignedPreKeyId = Math.max(...store.listSignedPreKeyIds(), 0) + 1;
      await createSignalSignedPreKey(options.signal, store, nextSignedPreKeyId);
      currentSignedPreKeyId = nextSignedPreKeyId;
    }

    const existingPreKeyIds = store.listPreKeyIds();
    const missingPreKeys = Math.max(0, preKeyCount - existingPreKeyIds.length);
    if (missingPreKeys) {
      const firstPreKeyId = await store.reservePreKeyIds(missingPreKeys);
      await createSignalPreKeyBatch(options.signal, store, firstPreKeyId, missingPreKeys);
    }
    const getPreKeys = () => store.listPreKeyIds().map((keyId) => {
      const record = store.loadPreKey(keyId);
      if (!record) throw new Error(`Persisted one-time prekey ${keyId} disappeared`);
      return { keyId, publicKey: record.publicKey };
    });
    const replenishPreKeys = async (targetCount = preKeyCount) => {
      if (!Number.isSafeInteger(targetCount) || targetCount < 0 || targetCount > 1000) {
        throw new RangeError("E2EE prekey target count must be between 0 and 1000");
      }
      const currentIds = store.listPreKeyIds();
      const missing = Math.max(0, targetCount - currentIds.length);
      if (missing) {
        const firstPreKeyId = await store.reservePreKeyIds(missing);
        await createSignalPreKeyBatch(options.signal, store, firstPreKeyId, missing);
      }
      return getPreKeys();
    };
    const rotateSignedPreKeyIfDue = async (now = Date.now()) => {
      if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Signed prekey rotation time must be a non-negative safe integer");
      const current = store.loadSignedPreKey(currentSignedPreKeyId);
      if (!current) throw new Error("Current signed prekey is missing from the encrypted store");
      if (now - current.createdAt < signedPreKeyRotationMs) return getSignedPreKey();
      const nextId = Math.max(...store.listSignedPreKeyIds(), 0) + 1;
      await createSignalSignedPreKey(options.signal, store, nextId, now);
      currentSignedPreKeyId = nextId;
      return getSignedPreKey();
    };

    let kyberPreKeys: Array<{ keyId: number; publicKey: string; signature: string }> = [];
    if (kyberPreKeyCount > 0 && typeof options.signal.KEMKeyPair?.generate === "function") {
      const existingKyberIds = store.listKyberPreKeyIds();
      const nextKyberId = existingKyberIds.length ? Math.max(...existingKyberIds) + 1 : 1;
      const missingKyberKeys = Math.max(0, kyberPreKeyCount - existingKyberIds.length);
      if (missingKyberKeys) {
        await createSignalKyberPreKeyBatch(
          options.signal, store, nextKyberId, missingKyberKeys
        );
      }
      // Restore public key material from persisted private records on every
      // startup so a warm restart can republish the same bundle.
      kyberPreKeys = store.listKyberPreKeyIds().map((keyId) =>
        loadSignalKyberPreKey(options.signal, store, keyId)
      );
    }

    let activeLocalDeviceId = options.localDeviceId;
    const localAddress = { name: options.accountId.trim(), deviceId: activeLocalDeviceId };
    const directMessages = createSignalDirectMessages(options.signal, store, localAddress);
    const setLocalDeviceId = (deviceId: number) => {
      if (!Number.isSafeInteger(deviceId) || deviceId < 1) throw new TypeError("Messenger local device ID must be a positive safe integer");
      activeLocalDeviceId = deviceId;
      directMessages.setLocalAddress({ name: options.accountId.trim(), deviceId });
    };
    const actions = createSignalE2EEActions({
      encrypt: directMessages.encrypt,
      decrypt: directMessages.decrypt
    });
    // Group Sender Key APIs are optional in some libsignal client builds. Keep
    // local identity/direct-message bootstrap available and instantiate the
    // group layer only when a caller actually requests it.
    let groups: ReturnType<typeof createSignalSenderKeyGroups> | undefined;
    const getGroups = () => {
      if (!groups) groups = createSignalSenderKeyGroups(options.signal, store);
      return groups;
    };

    return {
      store,
      directMessages,
      actions,
      get groups() { return getGroups(); },
      get localDeviceId() { return activeLocalDeviceId; },
      setLocalDeviceId,
      registrationId,
      identityKey,
      get signedPreKey() { return getSignedPreKey(); },
      get preKeys() { return getPreKeys(); },
      kyberPreKeys,
      replenishPreKeys,
      rotateSignedPreKeyIfDue,
      close: () => store.close()
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
