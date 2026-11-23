import { createSignalKeyStore, type SignalKeyStore } from "./signal-key-store";
import { ensureSignalIdentity, createSignalSignedPreKey } from "./libsignal-adapter";
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
  signal: Dynamic;
}

export interface SignalE2EERuntime {
  store: SignalKeyStore;
  directMessages: ReturnType<typeof createSignalDirectMessages>;
  actions: ReturnType<typeof createSignalE2EEActions>;
  groups: ReturnType<typeof createSignalSenderKeyGroups>;
  close(): Promise<void>;
}

/**
 * Creates the opt-in Signal runtime around an explicitly supplied libsignal module.
 * This initializes local keys only; Facebook device registration, bundle exchange,
 * MQTT envelopes and Messenger wire compatibility are intentionally separate steps.
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
    throw new TypeError("A compatible libsignal module must be explicitly supplied as signalModule");
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
      close: () => store.close()
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
