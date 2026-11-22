import { randomInt } from "node:crypto";
import type { SignalKeyStore, SignalSessionAddress } from "./signal-key-store";

type Dynamic = any;

function addressOf(address: Dynamic): SignalSessionAddress {
  return { name: address.name(), deviceId: address.deviceId() };
}

function bytesToBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function required<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`Signal ${label} not found`);
  return value;
}

/**
 * Bridges OmegA's encrypted persistence to Signal's current TypeScript store interfaces.
 * Pass the loaded @signalapp/libsignal-client module explicitly; no crypto is reimplemented here.
 */
export function createLibsignalStores(signal: Dynamic, store: SignalKeyStore) {
  if (!signal?.SessionStore || !signal?.IdentityKeyStore || !signal?.PreKeyStore ||
      !signal?.SignedPreKeyStore || !signal?.KyberPreKeyStore) {
    throw new TypeError("A compatible @signalapp/libsignal-client module is required");
  }

  class SessionStoreAdapter extends signal.SessionStore {
    async saveSession(address: Dynamic, record: Dynamic): Promise<void> {
      await store.storeSession(addressOf(address), bytesToBase64(record.serialize()));
    }
    async getSession(address: Dynamic): Promise<Dynamic> {
      const serialized = store.loadSession(addressOf(address));
      return serialized ? signal.SessionRecord.deserialize(fromBase64(serialized)) : null;
    }
    async getExistingSessions(addresses: Dynamic[]): Promise<Dynamic[]> {
      const records = await Promise.all(addresses.map((address) => this.getSession(address)));
      return records.map((record, index) => required(record, `session ${addresses[index].name()}.${addresses[index].deviceId()}`));
    }
  }

  class IdentityKeyStoreAdapter extends signal.IdentityKeyStore {
    async getIdentityKey(): Promise<Dynamic> {
      const record = required(store.getIdentityKeyPair(), "identity key pair");
      return signal.PrivateKey.deserialize(fromBase64(record.privateKey));
    }
    async getLocalRegistrationId(): Promise<number> {
      return required(store.getRegistrationId(), "registration ID");
    }
    async saveIdentity(address: Dynamic, key: Dynamic): Promise<number> {
      const previous = store.isTrustedIdentity(addressOf(address), bytesToBase64(key.serialize()));
      await store.saveIdentity(addressOf(address), bytesToBase64(key.serialize()));
      return previous ? signal.IdentityChange.NewOrUnchanged : signal.IdentityChange.ReplacedExisting;
    }
    async isTrustedIdentity(address: Dynamic, key: Dynamic): Promise<boolean> {
      return store.isTrustedIdentity(addressOf(address), bytesToBase64(key.serialize()));
    }
    async getIdentity(address: Dynamic): Promise<Dynamic> {
      const saved = store.getIdentity(addressOf(address));
      return saved ? signal.PublicKey.deserialize(fromBase64(saved)) : null;
    }
  }

  class PreKeyStoreAdapter extends signal.PreKeyStore {
    async savePreKey(id: number, record: Dynamic): Promise<void> {
      await store.storePreKey(id, {
        publicKey: bytesToBase64(record.publicKey().serialize()),
        privateKey: bytesToBase64(record.privateKey().serialize())
      });
    }
    async getPreKey(id: number): Promise<Dynamic> {
      const record = required(store.loadPreKey(id), `prekey ${id}`);
      return signal.PreKeyRecord.new(
        id,
        signal.PublicKey.deserialize(fromBase64(record.publicKey)),
        signal.PrivateKey.deserialize(fromBase64(record.privateKey))
      );
    }
    async removePreKey(id: number): Promise<void> {
      await store.removePreKey(id);
    }
  }

  class SignedPreKeyStoreAdapter extends signal.SignedPreKeyStore {
    async saveSignedPreKey(id: number, record: Dynamic): Promise<void> {
      await store.storeSignedPreKey({
        keyId: id,
        publicKey: bytesToBase64(record.publicKey().serialize()),
        privateKey: bytesToBase64(record.privateKey().serialize()),
        signature: bytesToBase64(record.signature()),
        createdAt: record.timestamp()
      });
    }
    async getSignedPreKey(id: number): Promise<Dynamic> {
      const record = required(store.loadSignedPreKey(id), `signed prekey ${id}`);
      return signal.SignedPreKeyRecord.new(
        id,
        record.createdAt,
        signal.PublicKey.deserialize(fromBase64(record.publicKey)),
        signal.PrivateKey.deserialize(fromBase64(record.privateKey)),
        fromBase64(record.signature)
      );
    }
  }

  class KyberPreKeyStoreAdapter extends signal.KyberPreKeyStore {
    async saveKyberPreKey(id: number, record: Dynamic): Promise<void> {
      await store.storeKyberPreKey(id, bytesToBase64(record.serialize()));
    }
    async getKyberPreKey(id: number): Promise<Dynamic> {
      const serialized = required(store.loadKyberPreKey(id), `Kyber prekey ${id}`);
      return signal.KyberPreKeyRecord.deserialize(fromBase64(serialized));
    }
    async markKyberPreKeyUsed(id: number, signedPreKeyId: number, baseKey: Dynamic): Promise<void> {
      await store.markKyberPreKeyUsed(id, signedPreKeyId, bytesToBase64(baseKey.serialize()));
    }
  }

  return {
    sessionStore: new SessionStoreAdapter(),
    identityKeyStore: new IdentityKeyStoreAdapter(),
    preKeyStore: new PreKeyStoreAdapter(),
    signedPreKeyStore: new SignedPreKeyStoreAdapter(),
    kyberPreKeyStore: new KyberPreKeyStoreAdapter()
  };
}

/** Creates local identity material using libsignal's own cryptographic implementation. */
export async function ensureSignalIdentity(signal: Dynamic, store: SignalKeyStore): Promise<void> {
  if (store.getIdentityKeyPair() && store.getRegistrationId() !== undefined) return;
  const privateKey = signal.PrivateKey.generate();
  const publicKey = privateKey.getPublicKey();
  await store.setIdentityKeyPair({
    publicKey: bytesToBase64(publicKey.serialize()),
    privateKey: bytesToBase64(privateKey.serialize())
  });
  await store.setRegistrationId(randomInt(1, 16381));
}

/** Generates and persists one signed prekey using the stored identity private key. */
export async function createSignalSignedPreKey(
  signal: Dynamic,
  store: SignalKeyStore,
  keyId: number,
  timestamp = Date.now()
): Promise<{ keyId: number; publicKey: string; signature: string }> {
  const identity = required(store.getIdentityKeyPair(), "identity key pair");
  const identityPrivateKey = signal.PrivateKey.deserialize(fromBase64(identity.privateKey));
  const keyPair = signal.PrivateKey.generate();
  const publicKey = keyPair.getPublicKey();
  const signature = identityPrivateKey.sign(publicKey.serialize());
  const record = signal.SignedPreKeyRecord.new(keyId, timestamp, publicKey, keyPair, signature);
  await store.storeSignedPreKey({
    keyId,
    publicKey: bytesToBase64(publicKey.serialize()),
    privateKey: bytesToBase64(keyPair.serialize()),
    signature: bytesToBase64(signature),
    createdAt: timestamp
  });
  return { keyId, publicKey: bytesToBase64(publicKey.serialize()), signature: bytesToBase64(signature) };
}

/** Generates a one-time EC prekey and returns only its public portion for publication. */
export async function createSignalPreKey(
  signal: Dynamic,
  store: SignalKeyStore,
  keyId: number
): Promise<{ keyId: number; publicKey: string }> {
  const keyPair = signal.PrivateKey.generate();
  const publicKey = keyPair.getPublicKey();
  await store.storePreKey(keyId, {
    publicKey: bytesToBase64(publicKey.serialize()),
    privateKey: bytesToBase64(keyPair.serialize())
  });
  return { keyId, publicKey: bytesToBase64(publicKey.serialize()) };
}

/** Generates a post-quantum Kyber prekey, signed by the account identity key. */
export async function createSignalKyberPreKey(
  signal: Dynamic,
  store: SignalKeyStore,
  keyId: number,
  timestamp = Date.now()
): Promise<{ keyId: number; publicKey: string; signature: string }> {
  const identity = required(store.getIdentityKeyPair(), "identity key pair");
  const identityPrivateKey = signal.PrivateKey.deserialize(fromBase64(identity.privateKey));
  const keyPair = signal.KEMKeyPair.generate();
  const publicKey = keyPair.getPublicKey();
  const signature = identityPrivateKey.sign(publicKey.serialize());
  const record = signal.KyberPreKeyRecord.new(keyId, timestamp, keyPair, signature);
  await store.storeKyberPreKey(keyId, bytesToBase64(record.serialize()));
  return { keyId, publicKey: bytesToBase64(publicKey.serialize()), signature: bytesToBase64(signature) };
}
