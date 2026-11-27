import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { encodeNode, marshal, type Node } from "./messenger-binary";
import type { MessengerNoiseSocket } from "./messenger-noise-socket";
import type { SignalE2EERuntime } from "./runtime";
import { MessengerPeerDirectory, createMessengerSignalPeerManager } from "./messenger-peer-directory";
import { createSignalGroupKeyManager } from "./group-key-manager";
import type { SignalPeerAddress } from "./direct-messages";

class ProtoWriter {
  private chunks: Buffer[] = [];
  private varint(value: number | bigint): Buffer {
    let n = BigInt(value); if (n < 0n) throw new RangeError("negative protobuf varint");
    const out: number[] = [];
    while (n > 127n) { out.push(Number((n & 127n) | 128n)); n >>= 7n; }
    out.push(Number(n)); return Buffer.from(out);
  }
  private header(field: number, wire: number): Buffer { return this.varint(BigInt(field * 8 + wire)); }
  var(field: number, value: number | bigint): this { this.chunks.push(this.header(field, 0), this.varint(value)); return this; }
  bytes(field: number, value: Uint8Array): this { const b = Buffer.from(value); this.chunks.push(this.header(field, 2), this.varint(b.length), b); return this; }
  string(field: number, value: string): this { return this.bytes(field, Buffer.from(value, "utf8")); }
  build(): Buffer { return Buffer.concat(this.chunks); }
}
type ProtoField = { wire: number; value: bigint | Buffer };
function readProto(input: Uint8Array): Map<number, ProtoField[]> {
  const data = Buffer.from(input), fields = new Map<number, ProtoField[]>(); let p = 0;
  const varint = (): bigint => { let v = 0n, shift = 0n; while (p < data.length && shift <= 63n) { const b = data[p++]!; v |= BigInt(b & 127) << shift; if (!(b & 128)) return v; shift += 7n; } throw new Error("Malformed protobuf varint"); };
  const push = (n: number, item: ProtoField) => { const list = fields.get(n) || []; list.push(item); fields.set(n, list); };
  while (p < data.length) {
    const tag = Number(varint()), n = tag >>> 3, wire = tag & 7;
    if (!n) throw new Error("Invalid protobuf field number");
    if (wire === 0) push(n, { wire, value: varint() });
    else if (wire === 2) { const len = Number(varint()); if (!Number.isSafeInteger(len) || len > data.length - p) throw new Error("Truncated protobuf field"); push(n, { wire, value: Buffer.from(data.subarray(p, p + len)) }); p += len; }
    else if (wire === 1 || wire === 5) { const len = wire === 1 ? 8 : 4; if (p + len > data.length) throw new Error("Truncated protobuf fixed field"); push(n, { wire, value: Buffer.from(data.subarray(p, p + len)) }); p += len; }
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  return fields;
}
function fieldBytes(fields: Map<number, ProtoField[]>, n: number): Buffer | undefined {
  const value = fields.get(n)?.find((f) => f.wire === 2)?.value; return Buffer.isBuffer(value) ? value : undefined;
}
function fieldString(fields: Map<number, ProtoField[]>, n: number): string | undefined { return fieldBytes(fields, n)?.toString("utf8"); }
function findNode(node: Node, tag: string): Node | undefined {
  if (node.tag === tag) return node;
  if (Array.isArray(node.content)) for (const child of node.content as Node[]) { const found = findNode(child, tag); if (found) return found; }
  return undefined;
}
function list(node: Node | undefined): Node[] { return Array.isArray(node?.content) ? node.content as Node[] : []; }
function jidAddress(jid: string): SignalPeerAddress {
  const [local = "", server = ""] = jid.split("@");
  if (server !== "msgr") throw new Error(`Unsupported E2EE sender JID ${jid}`);
  const m = /^([0-9]+)(?:[.:]([0-9]+))?$/.exec(local);
  if (!m) throw new Error(`Invalid E2EE sender JID ${jid}`);
  return { name: m[1]!, deviceId: Number(m[2] || 0) || 1 };
}
function makeTextApplication(text: string): { messageApp: Buffer; frankingTag: Buffer } {
  const msgText = new ProtoWriter().string(1, text).build();
  const content = new ProtoWriter().bytes(1, msgText).build();
  const payload = new ProtoWriter().bytes(1, content).build();
  const consumer = new ProtoWriter().bytes(1, payload).build();
  const consumerSub = new ProtoWriter().bytes(1, consumer).var(2, 1).build();
  const subProtocol = new ProtoWriter().var(1, 0).bytes(2, consumerSub).build();
  const appPayload = new ProtoWriter().bytes(4, subProtocol).build();
  const key = randomBytes(32);
  const metadata = new ProtoWriter().bytes(8, key).var(9, 0).build();
  const messageApp = new ProtoWriter().bytes(1, appPayload).bytes(2, metadata).build();
  return { messageApp, frankingTag: createHmac("sha256", key).update(messageApp).digest() };
}
function makeTransport(messageApp?: Buffer, skdm?: { groupId: string; bytes: Buffer }): Buffer {
  let payload: Buffer | undefined;
  if (messageApp) {
    const application = new ProtoWriter().bytes(1, messageApp).var(2, 2).build();
    payload = new ProtoWriter().bytes(1, application).var(3, 0).build();
  }
  const paddingLength = randomBytes(1)[0]! || 1;
  const padding = randomBytes(paddingLength);
  padding[paddingLength - 1] = paddingLength;
  const integral = new ProtoWriter().bytes(1, padding).build();
  let ancillary = new ProtoWriter();
  if (skdm) ancillary = ancillary.bytes(2, new ProtoWriter().string(1, skdm.groupId).bytes(2, skdm.bytes).build());
  const protocol = new ProtoWriter().bytes(1, integral).bytes(2, ancillary.build()).build();
  const out = new ProtoWriter();
  if (payload) out.bytes(1, payload);
  return out.bytes(2, protocol).build();
}
function decodeTransport(plaintext: Buffer): { messageApp?: Buffer; skdm?: { groupId: string; bytes: Buffer } } {
  const transport = readProto(plaintext);
  const payload = fieldBytes(transport, 1);
  let messageApp: Buffer | undefined;
  if (payload) {
    const appPayload = fieldBytes(readProto(payload), 1);
    if (appPayload) messageApp = fieldBytes(readProto(appPayload), 1);
  }
  const protocol = fieldBytes(transport, 2);
  const ancillary = protocol ? fieldBytes(readProto(protocol), 2) : undefined;
  const skdmPayload = ancillary ? fieldBytes(readProto(ancillary), 2) : undefined;
  let skdm: { groupId: string; bytes: Buffer } | undefined;
  if (skdmPayload) {
    const parsed = readProto(skdmPayload);
    const groupId = fieldString(parsed, 1), body = fieldBytes(parsed, 2);
    if (groupId && body) skdm = { groupId, bytes: body };
  }
  return { messageApp, skdm };
}
function decodeText(messageApp: Buffer): string | undefined {
  const appPayload = fieldBytes(readProto(messageApp), 1);
  if (!appPayload) return undefined;
  const payload = fieldBytes(readProto(appPayload), 4);
  if (!payload) return undefined;
  const consumerSub = fieldBytes(readProto(payload), 2);
  if (!consumerSub) return undefined;
  const consumer = fieldBytes(readProto(consumerSub), 1);
  if (!consumer) return undefined;
  const consumerPayload = fieldBytes(readProto(consumer), 1);
  if (!consumerPayload) return undefined;
  const content = fieldBytes(readProto(consumerPayload), 1);
  if (!content) return undefined;
  const messageText = fieldBytes(readProto(content), 1);
  return messageText ? fieldString(readProto(messageText), 1) : undefined;
}
function randomMessageId(): string { return String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))); }
function toADString(jid: string): string {
  const parsed = jidAddress(jid);
  return `${parsed.name}.0:${parsed.deviceId}@msgr`;
}
function participantHash(jids: string[]): string {
  const normalized = [...jids].map(toADString).sort();
  return `2:${createHash("sha256").update(normalized.join("")).digest().subarray(0, 6).toString("base64").replace(/=+$/, "")}`;
}

export interface MessengerE2EEMessageEvent {
  id: string;
  threadId: string;
  senderJid: string;
  senderId: string;
  text: string;
  timestampMs: number;
}
export interface MessengerE2EEServiceOptions {
  accountId: string;
  localDeviceId: number;
  runtime: SignalE2EERuntime;
  socket: MessengerNoiseSocket;
  signal: unknown;
}

/**
 * Native Messenger E2EE lifecycle: device fanout, Signal DM sessions, Sender-Key
 * group distribution, encrypted message stanzas, inbound decrypt, and acknowledgements.
 */
export class MessengerE2EEService extends EventEmitter {
  readonly directory: MessengerPeerDirectory;
  readonly peers: ReturnType<typeof createMessengerSignalPeerManager>;
  private readonly local: SignalPeerAddress;
  private readonly unsubscribe: () => void;
  private readonly groupKeys: ReturnType<typeof createSignalGroupKeyManager>;
  constructor(private readonly options: MessengerE2EEServiceOptions) {
    super();
    this.local = { name: options.accountId, deviceId: options.localDeviceId };
    this.directory = new MessengerPeerDirectory(options.socket);
    this.peers = createMessengerSignalPeerManager(options.runtime, options.socket, options.signal);
    this.groupKeys = createSignalGroupKeyManager({
      store: options.runtime.store,
      groups: options.runtime.groups,
      listMemberDevices: async (groupId, localSender) => {
        const members = await this.getGroupParticipants(groupId);
        const devices: SignalPeerAddress[] = [];
        for (const jid of members) {
          const user = jidAddress(jid).name;
          devices.push(...await this.directory.listDevices(user));
        }
        devices.push(...await this.directory.listDevices(localSender.name));
        return [...new Map(devices.map((device) => [`${device.name}.${device.deviceId}`, device])).values()]
          .filter((d) => !(d.name === localSender.name && d.deviceId === localSender.deviceId));
      },
      sendDistribution: async (recipient, distribution) => {
        await this.peers.ensureSession(recipient);
        const transport = makeTransport(undefined, { groupId: distribution.groupId, bytes: Buffer.from(distribution.body, "base64") });
        const encrypted = await options.runtime.directMessages.encrypt(recipient, transport);
        await this.sendDirectCiphertext(recipient, encrypted.type, Buffer.from(encrypted.body, "base64"));
      }
    });
    this.unsubscribe = options.socket.onNode((node) => {
      void this.handleNode(node).catch((error) => this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))));
    });
    options.socket.onClose((error) => this.emit("disconnected", error));
    void this.startup().catch((error) => this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))));
  }

  private async startup(): Promise<void> {
    await this.options.socket.sendFrame(marshal(encodeNode("presence", { type: "available" })));
    const sessionId = String((Date.now() + 3 * 24 * 60 * 60 * 1000) % (7 * 24 * 60 * 60 * 1000));
    await this.options.socket.sendFrame(marshal(encodeNode("ib", {}, [
      encodeNode("unified_session", { id: sessionId }),
      encodeNode("offline", {}),
      encodeNode("dirty", { type: "account_sync" })
    ])));
  }

  async syncGroupMembership(groupJid: string): Promise<void> {
    await this.groupKeys.syncMembership(groupJid, this.local);
  }

  private async getGroupParticipants(groupJid: string): Promise<string[]> {
    const id = `omega-group-${randomUUID()}`;
    const stanza = marshal(encodeNode("iq", { id, to: groupJid, type: "get", xmlns: "w:g2" }, [
      encodeNode("query", { request: "interactive" })
    ]));
    const response = await this.options.socket.sendIQ(stanza, id);
    const group = findNode(response, "group");
    return list(group).filter((n) => n.tag === "participant" && typeof n.attrs.jid === "string").map((n) => String(n.attrs.jid));
  }

  private async sendDirectCiphertext(recipient: SignalPeerAddress, type: number, ciphertext: Buffer): Promise<void> {
    const typeName = type === (this.options.signal as any)?.CiphertextMessageType?.PreKey ? "pkmsg" : "msg";
    const jid = `${recipient.name}.${recipient.deviceId}@msgr`;
    const id = randomMessageId();
    const stanza = marshal(encodeNode("message", { to: jid, id, type: "text" }, [
      encodeNode("enc", { v: "3", type: typeName }, ciphertext)
    ]));
    await this.options.socket.sendFrame(stanza);
  }

  async sendDirectText(peerId: string, text: string): Promise<string> {
    if (typeof text !== "string" || !text.length) throw new TypeError("E2EE text must be non-empty");
    if (!/^\d+$/.test(peerId)) throw new TypeError("Messenger peer ID must be numeric");
    const peerDevices = await this.peers.preparePeer(peerId);
    const ownDevices = await this.directory.listDevices(this.local.name);
    for (const device of ownDevices) {
      if (device.deviceId !== this.local.deviceId) await this.peers.ensureSession(device);
    }
    const all = [...new Map([...peerDevices, ...ownDevices].map((d) => [`${d.name}.${d.deviceId}`, d])).values()]
      .filter((d) => !(d.name === this.local.name && d.deviceId === this.local.deviceId));
    if (!all.length) throw new Error("No remote Messenger E2EE devices were discovered");
    const { messageApp, frankingTag } = makeTextApplication(text);
    const transport = makeTransport(messageApp);
    const participantNodes: Buffer[] = [];
    for (const device of all) {
      try {
        if (device.name === this.local.name && !this.options.runtime.store.loadSession(device)) continue;
        if (!this.options.runtime.store.loadSession(device)) await this.peers.ensureSession(device);
        const encrypted = await this.options.runtime.directMessages.encrypt(device, transport);
        const typeName = encrypted.type === (this.options.signal as any)?.CiphertextMessageType?.PreKey ? "pkmsg" : "msg";
        participantNodes.push(encodeNode("to", { jid: `${device.name}.${device.deviceId}@msgr` }, [
          encodeNode("enc", { v: "3", type: typeName }, Buffer.from(encrypted.body, "base64"))
        ]));
      } catch (error) { this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))); }
    }
    if (!participantNodes.length) throw new Error("Could not encrypt the message for any active device");
    const id = randomMessageId();
    const stanza = marshal(encodeNode("message", { to: `${peerId}.0@msgr`, type: "text", id }, [
      encodeNode("participants", {}, participantNodes),
      encodeNode("franking", {}, [encodeNode("franking_tag", {}, frankingTag)]),
      encodeNode("trace", {}, [encodeNode("request_id", {}, Buffer.from(randomUUID().replace(/-/g, ""), "hex"))])
    ]));
    await this.options.socket.sendFrame(stanza);
    return id;
  }

  async sendGroupText(groupJid: string, text: string): Promise<string> {
    if (!groupJid.endsWith("@g.us")) throw new TypeError("A Messenger group JID ending in @g.us is required");
    if (typeof text !== "string" || !text.length) throw new TypeError("E2EE text must be non-empty");
    const { messageApp, frankingTag } = makeTextApplication(text);
    const transport = makeTransport(messageApp);
    const encrypted = await this.groupKeys.encrypt(groupJid, this.local, transport);
    const participants = await this.getGroupParticipants(groupJid);
    const deviceJids: string[] = [];
    for (const member of [...participants, `${this.local.name}.0@msgr`]) {
      const user = jidAddress(member).name;
      for (const device of await this.directory.listDevices(user)) {
        if (!(device.name === this.local.name && device.deviceId === this.local.deviceId)) deviceJids.push(`${device.name}.${device.deviceId}@msgr`);
      }
    }
    const unique = [...new Set(deviceJids)];
    const phash = participantHash(unique);
    const id = randomMessageId();
    const stanza = marshal(encodeNode("message", { to: groupJid, type: "text", id, phash }, [
      encodeNode("franking", {}, [encodeNode("franking_tag", {}, frankingTag)]),
      encodeNode("trace", {}, [encodeNode("request_id", {}, Buffer.from(randomUUID().replace(/-/g, ""), "hex"))]),
      encodeNode("enc", { v: "3", type: "skmsg" }, Buffer.from(encrypted.body, "base64"))
    ]));
    await this.options.socket.sendFrame(stanza);
    return id;
  }

  private async handleNode(node: Node): Promise<void> {
    if (node.tag === "receipt") { this.emit("receipt", node); return; }
    if (node.tag === "iq" && node.attrs.xmlns === "urn:xmpp:ping" && node.attrs.type === "get") {
      await this.options.socket.sendFrame(marshal(encodeNode("iq", {
        id: String(node.attrs.id || ""), to: String(node.attrs.from || ""), type: "result"
      })));
      return;
    }
    if (node.tag === "notification" && node.attrs.type === "encrypt") {
      const count = Number(findNode(node, "count")?.attrs.value);
      if (Number.isFinite(count) && count < 5) {
        const { publishFacebookPreKeys } = await import("./prekey-publisher");
        await publishFacebookPreKeys(this.options.runtime, this.options.socket.sendIQ.bind(this.options.socket));
      }
      this.emit("notification", node);
      return;
    }
    if (node.tag !== "message") { this.emit("raw", node); return; }
    const senderJid = String(node.attrs.participant || node.attrs.from || "");
    const from = String(node.attrs.from || senderJid);
    const sender = jidAddress(senderJid);
    const participantNode = list(node).find((child) => child.tag === "participants");
    let participantProcessed = false;
    for (const recipientNode of list(participantNode)) {
      if (recipientNode.tag !== "to" || typeof recipientNode.attrs.jid !== "string") continue;
      const target = jidAddress(String(recipientNode.attrs.jid));
      if (target.name !== this.local.name || target.deviceId !== this.local.deviceId) continue;
      const participantEnc = list(recipientNode).find((child) => child.tag === "enc");
      if (!participantEnc || !Buffer.isBuffer(participantEnc.content)) continue;
      const type = participantEnc.attrs.type === "pkmsg"
        ? (this.options.signal as any).CiphertextMessageType.PreKey
        : (this.options.signal as any).CiphertextMessageType.Whisper;
      const dm = await this.options.runtime.directMessages.decrypt(sender, {
        type, body: Buffer.from(participantEnc.content).toString("base64")
      });
      const participantPayload = decodeTransport(Buffer.from(dm));
      if (participantPayload.skdm) {
        await this.options.runtime.groups.processDistribution({
          groupId: participantPayload.skdm.groupId, sender, body: participantPayload.skdm.bytes.toString("base64")
        });
        participantProcessed = true;
      }
    }
    const mainEnc = list(node).find((child) => child.tag === "enc");
    if (!mainEnc || !Buffer.isBuffer(mainEnc.content)) {
      if (participantProcessed && node.attrs.id) {
        await this.options.socket.sendFrame(marshal(encodeNode("ack", { class: "message", id: String(node.attrs.id), to: from })));
      }
      return;
    }
    let plaintext: Buffer;
    if (mainEnc.attrs.type === "skmsg") {
      const groupCipher = { groupId: from, sender, body: Buffer.from(mainEnc.content).toString("base64") };
      plaintext = Buffer.from(await this.options.runtime.groups.decrypt(groupCipher));
    } else if (mainEnc.attrs.type === "msg" || mainEnc.attrs.type === "pkmsg") {
      const type = mainEnc.attrs.type === "pkmsg"
        ? (this.options.signal as any).CiphertextMessageType.PreKey
        : (this.options.signal as any).CiphertextMessageType.Whisper;
      plaintext = Buffer.from(await this.options.runtime.directMessages.decrypt(sender, {
        type, body: Buffer.from(mainEnc.content).toString("base64")
      }));
    } else return;
    const decoded = decodeTransport(plaintext);
    if (decoded.skdm) {
      await this.options.runtime.groups.processDistribution({
        groupId: decoded.skdm.groupId, sender, body: decoded.skdm.bytes.toString("base64")
      });
    }
    if (decoded.messageApp) {
      const text = decodeText(decoded.messageApp);
      if (text !== undefined) {
        const event: MessengerE2EEMessageEvent = {
          id: String(node.attrs.id || ""), threadId: from, senderJid,
          senderId: sender.name, text, timestampMs: Number(node.attrs.t || Date.now()) * 1000
        };
        this.emit("message", event);
      }
    }
    const ackAttrs: Record<string, string> = { class: "message", id: String(node.attrs.id || ""), to: from };
    if (node.attrs.participant) ackAttrs.participant = String(node.attrs.participant);
    await this.options.socket.sendFrame(marshal(encodeNode("ack", ackAttrs)));
  }

  close(): void { this.unsubscribe(); this.options.socket.close(); }
}
