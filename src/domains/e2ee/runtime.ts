import { createSignalKeyStore, type SignalKeyStore } from "./signal-key-store";
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
  signal: Dynamic;
}

export interface SignalE2EERuntime {
  store: SignalKeyStore;
  directMessages: ReturnType<typeof createSignalDirectMessages>;
  actions: ReturnType<typeof createSignalE2EEActions>;
  groups: ReturnType<typeof createSignalSenderKeyGroups>;
  /** Stable Signal registration ID persisted for this account. */
  registrationId: number;
  /** Public identity key only; private identity material never leaves the encrypted store. */
  identityKey: string;
  /** Public signed-prekey bundle; private key material remains inside the encrypted store. */
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  /** Public portions only; private key material remains inside the encrypted store. */
  preKeys: Array<{ keyId: number; publicKey: string }>;
  kyberPreKeys: Array<{ keyId: number; publicKey: string; signature: string }>;
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

  const store = await createSignalKeyStore({
    accountId: options.accountId.trim(),
    storagePath: options.storagePath,
    encryptionKey: options.encryptionKey
  });

  try {
    await ensureSignalIdentity(options.signal, store);
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
    const signedPreKeyId = options.signedPreKeyId ??
      (existingSignedPreKeyIds.length ? Math.max(...existingSignedPreKeyIds) : 1);
    if (!store.loadSignedPreKey(signedPreKeyId)) {
      await createSignalSignedPreKey(options.signal, store, signedPreKeyId);
    }
    const persistedSignedPreKey = store.loadSignedPreKey(signedPreKeyId);
    if (!persistedSignedPreKey) throw new Error("Persisted signed prekey disappeared after initialization");
    const signedPreKey = {
      keyId: signedPreKeyId,
      publicKey: persistedSignedPreKey.publicKey,
      signature: persistedSignedPreKey.signature
    };

    const existingPreKeyIds = store.listPreKeyIds();
    const nextPreKeyId = existingPreKeyIds.length ? Math.max(...existingPreKeyIds) + 1 : 1;
    const missingPreKeys = Math.max(0, preKeyCount - existingPreKeyIds.length);
    if (missingPreKeys) {
      await createSignalPreKeyBatch(options.signal, store, nextPreKeyId, missingPreKeys);
    }
    // Always expose the complete persisted public bundle. Returning [] on a
    // warm restart would make callers unable to republish already-stored keys.
    const preKeys = store.listPreKeyIds().map((keyId) => {
      const record = store.loadPreKey(keyId);
      if (!record) throw new Error(`Persisted one-time prekey ${keyId} disappeared`);
      return { keyId, publicKey: record.publicKey };
    });

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

    const localAddress = { name: options.accountId.trim(), deviceId: options.localDeviceId };
    const directMessages = createSignalDirectMessages(options.signal, store, localAddress);
    const actions = createSignalE2EEActions({
      encrypt: directMessages.encrypt,
      decrypt: directMessages.decrypt
    });
    const groups = createSignalSenderKeyGroups(options.signal, store);

    return {
      store,
      directMessages,
      actions,
      groups,
      registrationId,
      identityKey,
      signedPreKey,
      preKeys,
      kyberPreKeys,
      close: () => store.close()
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
