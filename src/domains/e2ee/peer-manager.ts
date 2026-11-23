import type { SignalKeyStore } from "./signal-key-store";
import type { SignalPeerAddress, SignalCiphertext } from "./direct-messages";

export interface SignalRemoteDevice extends SignalPeerAddress {}
export interface SignalPeerManagerDeps {
  store: Pick<SignalKeyStore, "loadSession">;
  directMessages: {
    establishSession(remote: SignalPeerAddress, bundle: unknown): Promise<void>;
    encrypt(remote: SignalPeerAddress, plaintext: string | Uint8Array): Promise<SignalCiphertext>;
    decrypt(remote: SignalPeerAddress, ciphertext: SignalCiphertext): Promise<Uint8Array>;
  };
  /** Resolve the currently active Signal devices for a peer from the application's trusted directory. */
  listDevices(peerName: string): Promise<SignalRemoteDevice[]>;
  /** Fetch and parse a native libsignal PreKeyBundle for the exact peer device. */
  fetchPreKeyBundle(device: SignalRemoteDevice): Promise<unknown>;
}

function validatePeerName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("peerName must be a non-empty string");
  return value.trim();
}

function normalizeDevices(peerName: string, devices: SignalRemoteDevice[]): SignalRemoteDevice[] {
  if (!Array.isArray(devices)) throw new TypeError("listDevices must return an array");
  const seen = new Set<number>();
  return devices.map((device) => {
    if (!device || device.name !== peerName || !Number.isSafeInteger(device.deviceId) || device.deviceId < 1) {
      throw new TypeError("peer device directory returned an invalid or mismatched device");
    }
    if (seen.has(device.deviceId)) throw new Error(`duplicate Signal device ID: ${device.deviceId}`);
    seen.add(device.deviceId);
    return { name: peerName, deviceId: device.deviceId };
  }).sort((a, b) => a.deviceId - b.deviceId);
}

/**
 * Transport-neutral per-device session manager. The caller supplies the trusted
 * device directory and bundle transport; this module never guesses Messenger endpoints.
 */
export function createSignalPeerManager(deps: SignalPeerManagerDeps) {
  if (!deps?.store || typeof deps.store.loadSession !== "function" ||
      !deps.directMessages || typeof deps.directMessages.establishSession !== "function" ||
      typeof deps.directMessages.encrypt !== "function" || typeof deps.directMessages.decrypt !== "function" ||
      typeof deps.listDevices !== "function" || typeof deps.fetchPreKeyBundle !== "function") {
    throw new TypeError("Signal peer manager requires store, direct-message operations and device/bundle providers");
  }

  async function resolveDevices(peerNameInput: string): Promise<SignalRemoteDevice[]> {
    const peerName = validatePeerName(peerNameInput);
    return normalizeDevices(peerName, await deps.listDevices(peerName));
  }

  async function preparePeer(peerNameInput: string): Promise<SignalRemoteDevice[]> {
    const devices = await resolveDevices(peerNameInput);
    if (!devices.length) throw new Error("peer has no active Signal devices");
    for (const device of devices) {
      if (deps.store.loadSession(device)) continue;
      const bundle = await deps.fetchPreKeyBundle(device);
      if (!bundle || typeof bundle !== "object") throw new Error(`no valid PreKeyBundle for ${device.name}.${device.deviceId}`);
      await deps.directMessages.establishSession(device, bundle);
    }
    return devices;
  }

  async function encryptForPeer(peerNameInput: string, plaintext: string | Uint8Array) {
    const devices = await preparePeer(peerNameInput);
    const messages = [];
    for (const device of devices) {
      messages.push({ recipient: device, ciphertext: await deps.directMessages.encrypt(device, plaintext) });
    }
    return messages;
  }

  async function decryptFromDevice(remote: SignalRemoteDevice, ciphertext: SignalCiphertext): Promise<Uint8Array> {
    const peerName = validatePeerName(remote?.name);
    if (!Number.isSafeInteger(remote.deviceId) || remote.deviceId < 1) {
      throw new TypeError("remote deviceId must be a positive safe integer");
    }
    return deps.directMessages.decrypt({ name: peerName, deviceId: remote.deviceId }, ciphertext);
  }

  return { resolveDevices, preparePeer, encryptForPeer, decryptFromDevice };
}
