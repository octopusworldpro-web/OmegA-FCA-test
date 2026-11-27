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
      if (store.hasKyberPreKeyBeenUsed(id)) throw new Error(`Kyber prekey ${id} has already been consumed`);
      const serialized = required(store.loadKyberPreKey(id), `Kyber prekey ${id}`);
      return signal.KyberPreKeyRecord.deserialize(fromBase64(serialized));
    }
    async markKyberPreKeyUsed(id: number, signedPreKeyId: number, baseKey: Dynamic): Promise<void> {
      // The store operation atomically claims the one-time KEM key and persists
      // its use marker. Concurrent decryptions cannot both consume the same key.
      await store.consumeKyberPreKey(id, signedPreKeyId, bytesToBase64(baseKey.serialize()));
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
  // Preserve an existing identity if only the registration ID is missing.
  // Replacing a persisted identity would invalidate sessions and peer trust.
  if (!store.getIdentityKeyPair()) {
    const privateKey = signal.PrivateKey.generate();
    const publicKey = privateKey.getPublicKey();
    await store.setIdentityKeyPair({
      publicKey: bytesToBase64(publicKey.serialize()),
      privateKey: bytesToBase64(privateKey.serialize())
    });
  }
  if (store.getRegistrationId() === undefined) {
    await store.setRegistrationId(randomInt(1, 16381));
  }
}

/** Generates and persists one signed prekey using the stored identity private key. */
export async function createSignalSignedPreKey(
  signal: Dynamic,
  store: SignalKeyStore,
  keyId: number,
  timestamp = Date.now()
): Promise<{ keyId: number; publicKey: string; signature: string }> {
  if (!Number.isSafeInteger(keyId) || keyId < 0) throw new TypeError("keyId must be a non-negative safe integer");
  if (store.loadSignedPreKey(keyId)) throw new Error(`Signed prekey ${keyId} already exists`);
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
  if (!Number.isSafeInteger(keyId) || keyId < 0) throw new TypeError("keyId must be a non-negative safe integer");
  if (store.loadPreKey(keyId)) throw new Error(`One-time prekey ${keyId} already exists`);
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
  if (!Number.isSafeInteger(keyId) || keyId < 0) throw new TypeError("keyId must be a non-negative safe integer");
  if (store.loadKyberPreKey(keyId)) throw new Error(`Kyber prekey ${keyId} already exists`);
  const identity = required(store.getIdentityKeyPair(), "identity key pair");
  const identityPrivateKey = signal.PrivateKey.deserialize(fromBase64(identity.privateKey));
  const keyPair = signal.KEMKeyPair.generate();
  const publicKey = keyPair.getPublicKey();
  const signature = identityPrivateKey.sign(publicKey.serialize());
  const record = signal.KyberPreKeyRecord.new(keyId, timestamp, keyPair, signature);
  await store.storeKyberPreKey(keyId, bytesToBase64(record.serialize()));
  return { keyId, publicKey: bytesToBase64(publicKey.serialize()), signature: bytesToBase64(signature) };
}




/** Creates a collision-safe batch of one-time EC prekeys for later publication. */
export async function createSignalPreKeyBatch(
  signal: Dynamic,
  store: SignalKeyStore,
  startId: number,
  count: number
): Promise<Array<{ keyId: number; publicKey: string }>> {
  if (!Number.isSafeInteger(startId) || startId < 0) throw new TypeError("startId must be a non-negative safe integer");
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new RangeError("count must be between 1 and 1000");
  const ids = Array.from({ length: count }, (_, index) => startId + index);
  if (ids.some((id) => !Number.isSafeInteger(id) || store.loadPreKey(id))) {
    throw new Error("One-time prekey batch overlaps an existing or invalid key ID");
  }
  const generated = [];
  for (const id of ids) generated.push(await createSignalPreKey(signal, store, id));
  return generated;
}

/** Creates a batch of signed post-quantum Kyber prekeys for later publication. */
export async function createSignalKyberPreKeyBatch(
  signal: Dynamic,
  store: SignalKeyStore,
  startId: number,
  count: number,
  timestamp = Date.now()
): Promise<Array<{ keyId: number; publicKey: string; signature: string }>> {
  if (!Number.isSafeInteger(startId) || startId < 0) throw new TypeError("startId must be a non-negative safe integer");
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new RangeError("count must be between 1 and 1000");
  const ids = Array.from({ length: count }, (_, index) => startId + index);
  if (ids.some((id) => !Number.isSafeInteger(id) || store.loadKyberPreKey(id))) {
    throw new Error("Kyber prekey batch overlaps an existing or invalid key ID");
  }
  const generated = [];
  for (const id of ids) generated.push(await createSignalKyberPreKey(signal, store, id, timestamp));
  return generated;
}

/** Restores the public Kyber bundle from an encrypted persisted libsignal record. */
export function loadSignalKyberPreKey(
  signal: Dynamic,
  store: SignalKeyStore,
  keyId: number
): { keyId: number; publicKey: string; signature: string } {
  const serialized = required(store.loadKyberPreKey(keyId), `Kyber prekey ${keyId}`);
  if (typeof signal?.KyberPreKeyRecord?.deserialize !== "function") {
    throw new TypeError("A compatible libsignal KyberPreKeyRecord implementation is required");
  }
  const record = signal.KyberPreKeyRecord.deserialize(fromBase64(serialized));
  if (typeof record.publicKey !== "function" || typeof record.signature !== "function") {
    throw new TypeError("The Signal Kyber prekey record does not expose its public bundle");
  }
  return {
    keyId,
    publicKey: bytesToBase64(record.publicKey().serialize()),
    signature: bytesToBase64(record.signature())
  };
}

/** Creates the optional libsignal SenderKeyStore adapter used by group sessions. */
export function createLibsignalSenderKeyStore(signal: Dynamic, store: SignalKeyStore) {
  if (!signal?.SenderKeyStore || !signal?.SenderKeyRecord) {
    throw new TypeError("A compatible libsignal SenderKeyStore and SenderKeyRecord implementation is required");
  }
  return new (class extends signal.SenderKeyStore {
    async storeSenderKey(senderKeyName: Dynamic, record: Dynamic): Promise<void> {
      const address = senderKeyName.sender();
      await store.storeSenderKey(addressOf(address), senderKeyName.groupId(), bytesToBase64(record.serialize()));
    }
    async loadSenderKey(senderKeyName: Dynamic): Promise<Dynamic> {
      const address = senderKeyName.sender();
      const serialized = store.loadSenderKey(addressOf(address), senderKeyName.groupId());
      return serialized ? signal.SenderKeyRecord.deserialize(fromBase64(serialized)) : null;
    }
  })();
}

/**
 * Convert a Messenger encrypt-IQ response into the native libsignal PreKeyBundle.
 * Messenger currently publishes Curve25519 identity/signed/one-time keys; optional
 * Kyber fields are left null rather than fabricated.
 */
export function buildMessengerSignalPreKeyBundle(signal: Dynamic, raw: {
  registrationId: number;
  deviceId: number;
  identityKey: Uint8Array;
  signedPreKey: { keyId: number; publicKey: Uint8Array; signature: Uint8Array };
  preKey?: { keyId: number; publicKey: Uint8Array };
}): Dynamic {
  if (!signal?.PreKeyBundle?.new || !signal?.PublicKey?.deserialize) {
    throw new TypeError("A compatible libsignal PreKeyBundle and PublicKey API is required");
  }
  if (!Number.isSafeInteger(raw?.registrationId) || raw.registrationId < 1 ||
      !Number.isSafeInteger(raw?.deviceId) || raw.deviceId < 1) {
    throw new TypeError("Messenger PreKeyBundle registrationId and deviceId must be positive integers");
  }
  const publicKey = (value: Uint8Array, label: string) => {
    const bytes = Buffer.from(value);
    const normalized = bytes.length === 32 ? Buffer.concat([Buffer.from([0x05]), bytes]) : bytes;
    if (normalized.length !== 33 || normalized[0] !== 0x05) {
      throw new TypeError(`Messenger ${label} must be a 32-byte Curve25519 public key`);
    }
    return signal.PublicKey.deserialize(normalized);
  };
  const identity = publicKey(raw.identityKey, "identity key");
  const signed = publicKey(raw.signedPreKey.publicKey, "signed prekey");
  const signature = Buffer.from(raw.signedPreKey.signature);
  if (signature.length !== 64 || !Number.isSafeInteger(raw.signedPreKey.keyId) || raw.signedPreKey.keyId < 0) {
    throw new TypeError("Messenger signed prekey ID/signature is invalid");
  }
  if (raw.preKey) {
    if (!Number.isSafeInteger(raw.preKey.keyId) || raw.preKey.keyId < 0) {
      throw new TypeError("Messenger one-time prekey ID is invalid");
    }
    return signal.PreKeyBundle.new(
      raw.registrationId, raw.deviceId, raw.preKey.keyId,
      publicKey(raw.preKey.publicKey, "one-time prekey"),
      raw.signedPreKey.keyId, signed, signature, identity, null, null, null
    );
  }
  return signal.PreKeyBundle.new(
    raw.registrationId, raw.deviceId, null, null,
    raw.signedPreKey.keyId, signed, signature, identity, null, null, null
  );
}
