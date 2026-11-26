import { createSignalKeyStore, type SignalKeyStore } from "./signal-key-store";
import {
  ensureSignalIdentity,
  createSignalSignedPreKey,
  createSignalPreKeyBatch,
  createSignalKyberPreKeyBatch
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
    throw new TypeError("A compatible Signal implementation must be supplied as signalModule");
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
    let signedPreKeyId = options.signedPreKeyId;
    if (signedPreKeyId === undefined) {
      signedPreKeyId = store.listSignedPreKeyIds().length
        ? Math.max(...store.listSignedPreKeyIds()) + 1
        : 1;
    }
    if (!store.loadSignedPreKey(signedPreKeyId)) {
      await createSignalSignedPreKey(options.signal, store, signedPreKeyId);
    }

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

    const kyberPreKeys: Array<{ keyId: number; publicKey: string; signature: string }> = [];
    if (kyberPreKeyCount > 0 && typeof options.signal.KEMKeyPair?.generate === "function") {
      const existingKyberIds = store.listKyberPreKeyIds();
      const nextKyberId = existingKyberIds.length ? Math.max(...existingKyberIds) + 1 : 1;
      const missingKyberKeys = Math.max(0, kyberPreKeyCount - existingKyberIds.length);
      if (missingKyberKeys) {
        kyberPreKeys.push(...await createSignalKyberPreKeyBatch(
          options.signal, store, nextKyberId, missingKyberKeys
        ));
      }
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
      preKeys,
      kyberPreKeys,
      close: () => store.close()
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
