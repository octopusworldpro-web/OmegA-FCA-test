import { randomUUID } from "node:crypto";
import { encodeNode, marshal, type Node } from "./messenger-binary";
import type { MessengerNoiseSocket } from "./messenger-noise-socket";
import type { SignalE2EERuntime } from "./runtime";
import { buildMessengerSignalPreKeyBundle } from "./libsignal-adapter";
import { createSignalPeerManager } from "./peer-manager";

export interface MessengerRawPreKeyBundle {
  registrationId: number;
  deviceId: number;
  identityKey: Buffer;
  signedPreKey: { keyId: number; publicKey: Buffer; signature: Buffer };
  preKey?: { keyId: number; publicKey: Buffer };
}

function children(node: Node | undefined): Node[] {
  return Array.isArray(node?.content) ? node.content as Node[] : [];
}
function findNode(node: Node, tag: string): Node | undefined {
  if (node.tag === tag) return node;
  for (const child of children(node)) {
    const found = findNode(child, tag);
    if (found) return found;
  }
  return undefined;
}
function bytes(node: Node | undefined, label: string): Buffer {
  if (!node || !Buffer.isBuffer(node.content)) throw new Error(`Messenger response is missing binary ${label}`);
  return Buffer.from(node.content);
}
function keyId(node: Node | undefined, label: string): number {
  const value = bytes(node, label);
  if (value.length < 1 || value.length > 3) throw new Error(`Messenger ${label} must be a 1-3 byte ID`);
  return value.readUIntBE(0, value.length);
}
function rawPublicKey(node: Node | undefined, label: string): Buffer {
  const value = bytes(node, label);
  if (value.length !== 32) throw new Error(`Messenger ${label} must be 32 bytes`);
  return Buffer.concat([Buffer.from([0x05]), value]);
}
function parseMessengerJid(jid: string): { user: string; deviceId: number } {
  const [local = "", server = ""] = jid.split("@");
  if (server !== "msgr") throw new Error(`Unsupported Messenger device JID: ${jid}`);
  const colon = local.indexOf(":");
  const dot = local.indexOf(".");
  const userEnd = dot >= 0 ? dot : (colon >= 0 ? colon : local.length);
  const user = local.slice(0, userEnd);
  const deviceText = colon >= 0 ? local.slice(colon + 1) : (dot >= 0 ? local.slice(dot + 1) : "0");
  if (!/^\d+$/.test(user) || !/^\d+$/.test(deviceText)) throw new Error(`Invalid Messenger device JID: ${jid}`);
  return { user, deviceId: Number(deviceText) };
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

/** Native Messenger ICDC device-directory and encrypt-IQ bundle adapter. */
export class MessengerPeerDirectory {
  constructor(private socket: MessengerNoiseSocket, private readonly timeoutMs = 12000) {
    if (!socket || typeof socket.sendIQ !== "function") throw new TypeError("Authenticated Messenger Noise socket is required");
  }

  setSocket(socket: MessengerNoiseSocket): void {
    if (!socket || typeof socket.sendIQ !== "function") throw new TypeError("Authenticated Messenger Noise socket is required");
    this.socket = socket;
  }

  private async iq(to: string, xmlns: string, payload: Buffer[]): Promise<Node> {
    const id = `omega-${randomUUID()}`;
    const stanza = marshal(encodeNode("iq", { id, to, type: "get", xmlns }, payload));
    return await this.socket.sendIQ(stanza, id, this.timeoutMs) as Node;
  }

  async listDevices(peerNameInput: string): Promise<Array<{ name: string; deviceId: number }>> {
    const peerName = requiredText(peerNameInput, "peerName");
    if (!/^\d+$/.test(peerName)) throw new TypeError("Messenger peer ID must be numeric");
    const userJid = `${peerName}.0@msgr`;
    const response = await this.iq("s.whatsapp.net", "fbid:devices", [
      encodeNode("users", {}, [encodeNode("user", { jid: userJid })])
    ]);
    const users = findNode(response, "users");
    const user = children(users).find((item) => {
      if (item.tag !== "user" || typeof item.attrs.jid !== "string") return false;
      try { return parseMessengerJid(item.attrs.jid).user === peerName; } catch { return false; }
    });
    if (!user) return [];
    const devices = findNode(user, "devices");
    const result = children(devices).filter((item) => item.tag === "device").map((item) => {
      const id = Number(item.attrs.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("Messenger returned an invalid device ID");
      return { name: peerName, deviceId: id };
    });
    return [...new Map(result.map((device) => [device.deviceId, device])).values()].sort((a, b) => a.deviceId - b.deviceId);
  }

  async fetchPreKeyBundle(device: { name: string; deviceId: number }): Promise<MessengerRawPreKeyBundle> {
    const name = requiredText(device?.name, "device.name");
    if (!/^\d+$/.test(name) || !Number.isSafeInteger(device.deviceId) || device.deviceId < 1) {
      throw new TypeError("Messenger peer device address is invalid");
    }
    const jid = `${name}.${device.deviceId}@msgr`;
    const response = await this.iq("s.whatsapp.net", "encrypt", [
      encodeNode("key", {}, [encodeNode("user", { jid })])
    ]);
    const user = findNode(response, "user");
    const keyRoot = findNode(response, "key");
    if (!user || !keyRoot) throw new Error(`Messenger returned no prekey bundle for ${jid}`);
    const registration = bytes(findNode(user, "registration"), "registration ID");
    if (registration.length !== 4) throw new Error("Messenger registration ID must be uint32");
    const identityKey = rawPublicKey(findNode(user, "identity"), "identity key");
    const signedNode = findNode(user, "skey");
    if (!signedNode) throw new Error("Messenger signed prekey is missing");
    const signedPreKey = {
      keyId: keyId(findNode(signedNode, "id"), "signed prekey ID"),
      publicKey: rawPublicKey(findNode(signedNode, "value"), "signed prekey public key"),
      signature: bytes(findNode(signedNode, "signature"), "signed prekey signature")
    };
    const findOneTimeKey = (node: Node): Node | undefined => {
      if (node.tag === "key" && findNode(node, "id") && findNode(node, "value")) return node;
      for (const child of children(node)) {
        const found = findOneTimeKey(child);
        if (found) return found;
      }
      return undefined;
    };
    const oneTimeNode = findOneTimeKey(keyRoot);
    const preKey = oneTimeNode && findNode(oneTimeNode, "value")
      ? {
          keyId: keyId(findNode(oneTimeNode, "id"), "one-time prekey ID"),
          publicKey: rawPublicKey(findNode(oneTimeNode, "value"), "one-time prekey public key")
        }
      : undefined;
    return {
      registrationId: registration.readUInt32BE(0),
      deviceId: device.deviceId,
      identityKey,
      signedPreKey,
      preKey
    };
  }
}

/** Wires native Messenger device discovery/bundle fetch into the existing Signal peer manager. */
export function createMessengerSignalPeerManager(runtime: SignalE2EERuntime, socket: MessengerNoiseSocket, signal: unknown) {
  if (!runtime?.store || !runtime?.directMessages) throw new TypeError("Initialized Signal runtime is required");
  const directory = new MessengerPeerDirectory(socket);
  return createSignalPeerManager({
    store: runtime.store,
    directMessages: runtime.directMessages,
    listDevices: (peerName) => directory.listDevices(peerName),
    fetchPreKeyBundle: (device) => directory.fetchPreKeyBundle(device),
    parsePreKeyBundle: (payload, device) => {
      const raw = payload as MessengerRawPreKeyBundle;
      if (raw.deviceId !== device.deviceId) throw new Error("Messenger PreKeyBundle device ID mismatch");
      return buildMessengerSignalPreKeyBundle(signal, raw);
    }
  });
}
