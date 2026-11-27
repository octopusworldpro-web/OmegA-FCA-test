import type { SignalPeerAddress } from "./direct-messages";
import type { SignalKeyStore } from "./signal-key-store";
import type { SenderKeyDistribution, SenderKeyCiphertext } from "./sender-keys";

export interface SignalGroupDevice extends SignalPeerAddress {}
export interface SignalGroupKeyManagerDeps {
  store: Pick<SignalKeyStore, "removeSenderKey" | "getSenderKeyDistributionRecipients" | "markSenderKeyDistributionDelivered" | "clearSenderKeyDistribution">;
  groups: {
    createDistribution(groupId: string, localSender: SignalPeerAddress): Promise<SenderKeyDistribution>;
    processDistribution(distribution: SenderKeyDistribution): Promise<void>;
    encrypt(groupId: string, localSender: SignalPeerAddress, plaintext: string | Uint8Array): Promise<SenderKeyCiphertext>;
    decrypt(ciphertext: SenderKeyCiphertext): Promise<Uint8Array>;
  };
  /** Return every active device of every current group member, excluding localSender. */
  listMemberDevices(groupId: string, localSender: SignalPeerAddress): Promise<SignalGroupDevice[]>;
  /** Deliver the SKDM privately to one recipient device using an authenticated 1:1 channel. */
  sendDistribution(recipient: SignalGroupDevice, distribution: SenderKeyDistribution): Promise<void>;
}

function validAddress(address: SignalPeerAddress, label: string): SignalPeerAddress {
  if (!address || typeof address.name !== "string" || !address.name.trim() ||
      !Number.isSafeInteger(address.deviceId) || address.deviceId < 1) {
    throw new TypeError(`${label} requires a non-empty name and positive deviceId`);
  }
  return { name: address.name.trim(), deviceId: address.deviceId };
}
function validGroupId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("groupId is required");
  return value.trim();
}
function normalizeMembers(devices: SignalGroupDevice[], local: SignalPeerAddress): SignalGroupDevice[] {
  if (!Array.isArray(devices)) throw new TypeError("listMemberDevices must return an array");
  const seen = new Set<string>();
  return devices.map((device) => validAddress(device, "member device"))
    .filter((device) => !(device.name === local.name && device.deviceId === local.deviceId))
    .filter((device) => {
      const key = `${device.name}.${device.deviceId}`;
      if (seen.has(key)) throw new Error(`duplicate group member device: ${key}`);
      seen.add(key);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name) || a.deviceId - b.deviceId);
}

/** Coordinates Sender Key distribution over an authenticated direct-message transport. */
export function createSignalGroupKeyManager(deps: SignalGroupKeyManagerDeps) {
  if (!deps?.store || typeof deps.store.removeSenderKey !== "function" ||
      typeof deps.store.getSenderKeyDistributionRecipients !== "function" ||
      typeof deps.store.markSenderKeyDistributionDelivered !== "function" ||
      typeof deps.store.clearSenderKeyDistribution !== "function" ||
      !deps.groups || typeof deps.groups.createDistribution !== "function" ||
      typeof deps.groups.processDistribution !== "function" ||
      typeof deps.groups.encrypt !== "function" || typeof deps.groups.decrypt !== "function" ||
      typeof deps.listMemberDevices !== "function" || typeof deps.sendDistribution !== "function") {
    throw new TypeError("Group key manager requires Signal group primitives, member directory and SKDM transport");
  }

  const distributed = new Map<string, Set<string>>();
  const distributionCache = new Map<string, SenderKeyDistribution>();
  const inFlight = new Map<string, Promise<{ distribution: SenderKeyDistribution; recipients: SignalGroupDevice[] }>>();
  const keyId = (groupId: string, sender: SignalPeerAddress) => JSON.stringify([groupId, sender.name, sender.deviceId]);
  const deviceId = (device: SignalGroupDevice) => `${device.name}.${device.deviceId}`;

  async function distribute(groupIdInput: string, senderInput: SignalPeerAddress) {
    const groupId = validGroupId(groupIdInput);
    const sender = validAddress(senderInput, "local sender");
    const distributionKey = keyId(groupId, sender);
    const pending = inFlight.get(distributionKey);
    if (pending) return pending;

    const operation = (async () => {
      const recipients = normalizeMembers(await deps.listMemberDevices(groupId, sender), sender);
      if (!recipients.length) throw new Error("group has no remote member devices for Sender Key distribution");
      let distribution = distributionCache.get(distributionKey);
      if (!distribution) {
        distribution = await deps.groups.createDistribution(groupId, sender);
        distributionCache.set(distributionKey, distribution);
      }
      const sent = distributed.get(distributionKey) ??
        new Set<string>(deps.store.getSenderKeyDistributionRecipients(sender, groupId));
      distributed.set(distributionKey, sent);
      const newlySent: SignalGroupDevice[] = [];
      for (const recipient of recipients) {
        if (sent.has(deviceId(recipient))) continue;
        await deps.sendDistribution(recipient, distribution);
        await deps.store.markSenderKeyDistributionDelivered(sender, groupId, recipient);
        sent.add(deviceId(recipient));
        newlySent.push(recipient);
      }
      return { distribution, recipients: newlySent };
    })();
    inFlight.set(distributionKey, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(distributionKey) === operation) inFlight.delete(distributionKey);
    }
  }

  async function encrypt(groupIdInput: string, senderInput: SignalPeerAddress, plaintext: string | Uint8Array) {
    const groupId = validGroupId(groupIdInput);
    const sender = validAddress(senderInput, "local sender");
    await distribute(groupId, sender);
    return deps.groups.encrypt(groupId, sender, plaintext);
  }

  async function processIncomingDistribution(distribution: SenderKeyDistribution): Promise<void> {
    await deps.groups.processDistribution(distribution);
  }

  async function rotate(groupIdInput: string, senderInput: SignalPeerAddress) {
    const groupId = validGroupId(groupIdInput);
    const sender = validAddress(senderInput, "local sender");
    const pending = inFlight.get(keyId(groupId, sender));
    if (pending) await pending.catch(() => undefined);
    await deps.store.removeSenderKey(sender, groupId);
    await deps.store.clearSenderKeyDistribution(sender, groupId);
    const distributionKey = keyId(groupId, sender);
    distributed.delete(distributionKey);
    distributionCache.delete(distributionKey);
    inFlight.delete(distributionKey);
    return distribute(groupId, sender);
  }

  async function syncMembership(groupIdInput: string, senderInput: SignalPeerAddress) {
    // Membership changes must rotate the sender key so removed members cannot decrypt future messages.
    return rotate(validGroupId(groupIdInput), validAddress(senderInput, "local sender"));
  }

  return {
    distribute,
    encrypt,
    processIncomingDistribution,
    decrypt: (ciphertext: SenderKeyCiphertext, expected?: { groupId?: string; sender?: SignalPeerAddress }) => {
      if (!ciphertext || typeof ciphertext !== "object") throw new TypeError("group ciphertext is required");
      const groupId = validGroupId(ciphertext.groupId);
      const sender = validAddress(ciphertext.sender, "ciphertext sender");
      if (expected?.groupId !== undefined && validGroupId(expected.groupId) !== groupId) {
        throw new Error("group ciphertext groupId does not match expected group");
      }
      if (expected?.sender !== undefined) {
        const expectedSender = validAddress(expected.sender, "expected sender");
        if (expectedSender.name !== sender.name || expectedSender.deviceId !== sender.deviceId) {
          throw new Error("group ciphertext sender does not match expected sender device");
        }
      }
      return deps.groups.decrypt({ ...ciphertext, groupId, sender });
    },
    rotate,
    syncMembership
  };
}
