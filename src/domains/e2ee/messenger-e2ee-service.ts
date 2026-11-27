import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { encodeNode, marshal, type Node } from "./messenger-binary";
import type { MessengerNoiseSocket } from "./messenger-noise-socket";
import type { SignalE2EERuntime } from "./runtime";
import { MessengerPeerDirectory, createMessengerSignalPeerManager } from "./messenger-peer-directory";
import { createSignalGroupKeyManager } from "./group-key-manager";
import type { SignalPeerAddress } from "./direct-messages";
import { createSignalEncryptedDirectMediaMessaging } from "./direct-media-messaging";
import { createSignalEncryptedGroupMedia } from "./encrypted-group-media";
import { createSignalEncryptedGroupMediaMessaging } from "./group-media-messaging";
import {
  encryptMessengerMedia, decryptMessengerMedia, fetchMessengerMediaUploadConfig, uploadMessengerMedia,
  buildMessengerMediaApplication, type MessengerMediaFields, type MessengerMediaType
} from "./messenger-media";

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
  const colon = local.indexOf(":");
  const dot = local.indexOf(".");
  const userEnd = dot >= 0 ? dot : (colon >= 0 ? colon : local.length);
  const name = local.slice(0, userEnd);
  const deviceText = colon >= 0 ? local.slice(colon + 1) : (dot >= 0 ? local.slice(dot + 1) : "0");
  if (!/^\d+$/.test(name) || !/^\d+$/.test(deviceText)) throw new Error(`Invalid E2EE sender JID ${jid}`);
  return { name, deviceId: Number(deviceText) || 1 };
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
function makeTransport(messageApp?: Buffer, skdm?: { groupId: string; bytes: Buffer }, dsm?: { destinationJid: string; phash: string }): Buffer {
  let payload: Buffer | undefined;
  if (messageApp) {
    const application = new ProtoWriter().bytes(1, messageApp).var(2, 2).build();
    payload = new ProtoWriter().bytes(1, application).var(3, 0).build();
  }
  const paddingLength = randomBytes(1)[0]! || 1;
  const padding = randomBytes(paddingLength);
  padding[paddingLength - 1] = paddingLength;
  let integralWriter = new ProtoWriter().bytes(1, padding);
  if (dsm) integralWriter = integralWriter.bytes(2, new ProtoWriter().string(1, dsm.destinationJid).string(2, dsm.phash).build());
  const integral = integralWriter.build();
  let ancillary = new ProtoWriter();
  if (skdm) ancillary = ancillary.bytes(2, new ProtoWriter().string(1, skdm.groupId).bytes(2, skdm.bytes).build());
  const protocol = new ProtoWriter().bytes(1, integral).bytes(2, ancillary.build()).build();
  const out = new ProtoWriter();
  if (payload) out.bytes(1, payload);
  return out.bytes(2, protocol).build();
}
function decodeTransport(plaintext: Buffer): { messageApp?: Buffer; skdm?: { groupId: string; bytes: Buffer }; destinationJid?: string } {
  const transport = readProto(plaintext);
  const payload = fieldBytes(transport, 1);
  let messageApp: Buffer | undefined;
  if (payload) {
    const appPayload = fieldBytes(readProto(payload), 1);
    if (appPayload) messageApp = fieldBytes(readProto(appPayload), 1);
  }
  const protocol = fieldBytes(transport, 2);
  const protocolFields = protocol ? readProto(protocol) : undefined;
  const integral = protocolFields ? fieldBytes(protocolFields, 1) : undefined;
  const dsm = integral ? fieldBytes(readProto(integral), 2) : undefined;
  const destinationJid = dsm ? fieldString(readProto(dsm), 1) : undefined;
  const ancillary = protocolFields ? fieldBytes(protocolFields, 2) : undefined;
  const skdmPayload = ancillary ? fieldBytes(readProto(ancillary), 2) : undefined;
  let skdm: { groupId: string; bytes: Buffer } | undefined;
  if (skdmPayload) {
    const parsed = readProto(skdmPayload);
    const groupId = fieldString(parsed, 1), body = fieldBytes(parsed, 2);
    if (groupId && body) skdm = { groupId, bytes: body };
  }
  return { messageApp, skdm, destinationJid };
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
function decodeMessengerMediaApplication(messageApp: Buffer): MessengerMediaFields | undefined {
  const appPayload = fieldBytes(readProto(messageApp), 1);
  if (!appPayload) return undefined;
  const subProtocol = fieldBytes(readProto(appPayload), 4);
  const consumerSub = subProtocol ? fieldBytes(readProto(subProtocol), 2) : undefined;
  const consumer = consumerSub ? fieldBytes(readProto(consumerSub), 1) : undefined;
  const consumerPayload = consumer ? fieldBytes(readProto(consumer), 1) : undefined;
  const content = consumerPayload ? fieldBytes(readProto(consumerPayload), 1) : undefined;
  if (!content) return undefined;
  const contentFields = readProto(content);
  const candidates: Array<[number, MessengerMediaType]> = [[2, "image"], [9, "video"], [8, "audio"], [7, "document"]];
  let kind: MessengerMediaType | undefined, wrapper: Buffer | undefined;
  for (const [field, candidate] of candidates) {
    wrapper = fieldBytes(contentFields, field);
    if (wrapper) { kind = candidate; break; }
  }
  if (!kind || !wrapper) return undefined;
  const mediaSubProtocol = fieldBytes(readProto(wrapper), 1);
  const mediaPayload = mediaSubProtocol ? fieldBytes(readProto(mediaSubProtocol), 1) : undefined;
  const mediaPayloadFields = mediaPayload ? readProto(mediaPayload) : undefined;
  const mediaIntegral = mediaPayloadFields ? fieldBytes(mediaPayloadFields, 1) : undefined;
  const common = mediaIntegral ? fieldBytes(readProto(mediaIntegral), 1) : undefined;
  if (!common) return undefined;
  const commonFields = readProto(common);
  const integral = fieldBytes(commonFields, 1);
  const ancillary = fieldBytes(commonFields, 2);
  if (!integral || !ancillary) return undefined;
  const integralFields = readProto(integral), ancillaryFields = readProto(ancillary);
  const mediaKey = fieldBytes(integralFields, 2), fileSHA256 = fieldBytes(integralFields, 1);
  const fileEncSHA256 = fieldBytes(integralFields, 3), directPath = fieldString(integralFields, 4);
  const fileLength = ancillaryFields.get(1)?.[0]?.value;
  const mimeType = fieldString(ancillaryFields, 2);
  if (!mediaKey || mediaKey.length !== 32 || !fileSHA256 || !fileEncSHA256 || !directPath || typeof fileLength !== "bigint" || !mimeType) {
    throw new Error("Decrypted Messenger media message is missing required media fields");
  }
  const timestamp = integralFields.get(5)?.[0]?.value;
  const dimensions = mediaPayloadFields ? fieldBytes(mediaPayloadFields, 2) : undefined;
  const dimensionFields = dimensions ? readProto(dimensions) : new Map<number, ProtoField[]>();
  const wrapperFields = readProto(wrapper);
  const captionBytes = kind === "image" || kind === "video" ? fieldBytes(wrapperFields, 2) : undefined;
  const caption = captionBytes ? fieldString(readProto(captionBytes), 1) : undefined;
  return {
    kind, mediaKey, fileSHA256, fileEncSHA256, directPath, mimeType,
    fileLength: Number(fileLength), mediaKeyTimestamp: typeof timestamp === "bigint" ? Number(timestamp) : 0,
    objectId: fieldString(ancillaryFields, 4), caption,
    fileName: kind === "document" ? fieldString(wrapperFields, 2) : undefined,
    width: kind === "image" ? Number(dimensionFields.get(2)?.[0]?.value) || undefined : kind === "video" ? Number(dimensionFields.get(5)?.[0]?.value) || undefined : undefined,
    height: kind === "image" ? Number(dimensionFields.get(1)?.[0]?.value) || undefined : kind === "video" ? Number(dimensionFields.get(4)?.[0]?.value) || undefined : undefined,
    seconds: kind === "video" || kind === "audio" ? Number(dimensionFields.get(1)?.[0]?.value) || undefined : undefined,
    ptt: kind === "audio" ? Boolean(wrapperFields.get(2)?.[0]?.value) : undefined
  };
}
function inferMessengerMediaType(metadata: { fileName?: string; contentType?: string }): MessengerMediaType {
  const mime = (metadata.contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = (metadata.fileName || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp","heic","heif","bmp"].includes(ext)) return "image";
  if (["mp4","mov","avi","mkv","webm","3gp","m4v"].includes(ext)) return "video";
  if (["mp3","ogg","aac","flac","wav","m4a","opus"].includes(ext)) return "audio";
  return "document";
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
  reconnect?: () => Promise<MessengerNoiseSocket>;
}

/**
 * Native Messenger E2EE lifecycle: device fanout, Signal DM sessions, Sender-Key
 * group distribution, encrypted message stanzas, inbound decrypt, and acknowledgements.
 */
export class MessengerE2EEService extends EventEmitter {
  readonly directory: MessengerPeerDirectory;
  readonly peers: ReturnType<typeof createMessengerSignalPeerManager>;
  private readonly local: SignalPeerAddress;
  private unsubscribe: () => void = () => {};
  private unsubscribeClose: () => void = () => {};
  readonly ready: Promise<void>;
  private readonly groupKeys: ReturnType<typeof createSignalGroupKeyManager>;
  private readonly directMedia: ReturnType<typeof createSignalEncryptedDirectMediaMessaging>;
  private readonly groupMedia: ReturnType<typeof createSignalEncryptedGroupMediaMessaging>;
  private readonly pendingMessageAcks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; stanza: Buffer; attempts: number }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private readonly retryCounts = new Map<string, number>();
  private readonly seenIncoming = new Set<string>();
  constructor(private options: MessengerE2EEServiceOptions) {
    super();
    this.local = { name: options.accountId, deviceId: options.localDeviceId };
    this.peers = createMessengerSignalPeerManager(options.runtime, options.socket, options.signal);
    this.directory = this.peers.directory;
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
        const transport = makeTransport(undefined, { groupId: distribution.groupId, bytes: Buffer.from(distribution.body, "base64") },
          recipient.name === this.local.name ? { destinationJid: distribution.groupId, phash: "" } : undefined);
        const encrypted = await options.runtime.directMessages.encrypt(recipient, transport);
        await this.sendDirectCiphertext(recipient, encrypted.type, Buffer.from(encrypted.body, "base64"));
      }
    });
    this.directMedia = createSignalEncryptedDirectMediaMessaging({
      signal: options.runtime.directMessages,
      sendEnvelope: async (_peerId, remote, envelope) => {
        const transport = makeTransport(makeTextApplication(JSON.stringify(envelope)).messageApp);
        const encrypted = await options.runtime.directMessages.encrypt(remote, transport);
        await this.sendDirectCiphertext(remote, encrypted.type, Buffer.from(encrypted.body, "base64"));
      }
    });
    const groupMediaEngine = createSignalEncryptedGroupMedia(options.runtime.groups);
    this.groupMedia = createSignalEncryptedGroupMediaMessaging({
      media: {
        encryptAndUpload: groupMediaEngine.encryptAndUpload,
        downloadAndDecrypt: (descriptor, download, expected) =>
          groupMediaEngine.downloadAndDecrypt(descriptor, (item) => download(item, undefined), expected)
      },
      sendEnvelope: async (groupId, envelope) => { await this.sendGroupText(groupId, JSON.stringify(envelope)); }
    });
    this.attachSocket(options.socket);
    this.ready = this.startup();
    this.ready.catch((error) => this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))));
  }

  private attachSocket(socket: MessengerNoiseSocket): void {
    this.unsubscribe = socket.onNode((node) => {
      void this.handleNode(node).catch(async (error) => {
        if (node.tag === "message") await this.sendRetryReceipt(node).catch((retryError) => this.emit("e2ee_error", retryError));
        this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error)));
      });
    });
    this.unsubscribeClose = socket.onClose((error) => this.handleDisconnect(error));
  }

  private handleDisconnect(error: Error): void {
    for (const [id, pending] of this.pendingMessageAcks) {
      clearTimeout(pending.timer);
      if (!this.options.reconnect) {
        pending.reject(error);
        this.pendingMessageAcks.delete(id);
      }
    }
    this.emit("disconnected", error);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.options.reconnect || this.reconnectTimer) return;
    if (this.reconnectAttempts >= 5) {
      const error = new Error("Messenger E2EE reconnect attempts exhausted");
      for (const [id, pending] of this.pendingMessageAcks) {
        clearTimeout(pending.timer);
        pending.reject(error);
        this.pendingMessageAcks.delete(id);
      }
      this.emit("reconnect_failed", error);
      return;
    }
    const attempt = this.reconnectAttempts++;
    const delay = Math.min(30000, 1000 * (2 ** attempt));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const socket = await this.options.reconnect!();
        await this.replaceConnection(socket);
        this.reconnectAttempts = 0;
        this.emit("reconnected");
      } catch (error) {
        this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error)));
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async replaceConnection(socket: MessengerNoiseSocket): Promise<void> {
    if (this.closed) { socket.close(); throw new Error("Messenger E2EE service is closed"); }
    const previousSocket = this.options.socket;
    this.unsubscribe();
    this.unsubscribeClose();
    if (previousSocket !== socket) previousSocket.close();
    this.options.socket = socket;
    this.directory.setSocket(socket);
    this.attachSocket(socket);
    try {
      await this.startup();
    } catch (error) {
      this.unsubscribe();
      this.unsubscribeClose();
      socket.close();
      throw error;
    }
    for (const [id, pending] of this.pendingMessageAcks) this.transmitPending(id, pending, 15000);
  }

  get socket(): MessengerNoiseSocket { return this.options.socket; }

  private async startup(): Promise<void> {
    await this.options.socket.sendFrame(marshal(encodeNode("presence", { type: "available" })));
    const sessionId = String((Date.now() + 3 * 24 * 60 * 60 * 1000) % (7 * 24 * 60 * 60 * 1000));
    await this.options.socket.sendFrame(marshal(encodeNode("ib", {}, [
      encodeNode("unified_session", { id: sessionId }),
      encodeNode("offline", {}),
      encodeNode("dirty", { type: "account_sync" })
    ])));
    await this.restorePendingMessages();
    await this.refreshTrackedGroupMemberships();
  }

  private async restorePendingMessages(): Promise<void> {
    const store = this.options.runtime.store as any;
    if (typeof store.listPendingMessengerMessages !== "function") return;
    for (const record of store.listPendingMessengerMessages()) {
      if (this.pendingMessageAcks.has(record.id)) continue;
      const pending = {
        resolve: () => {}, reject: (_error: Error) => {},
        timer: setTimeout(() => {}, 0), stanza: Buffer.from(record.stanza, "base64"), attempts: 0
      };
      clearTimeout(pending.timer);
      this.pendingMessageAcks.set(record.id, pending);
      this.transmitPending(record.id, pending, 15000);
    }
  }

  private async groupMemberDeviceSnapshot(groupJid: string, participants: string[]): Promise<string[]> {
    const members = [...participants, `${this.local.name}.0@msgr`];
    const devices: string[] = [];
    for (const member of members) {
      const user = jidAddress(member).name;
      for (const device of await this.directory.listDevices(user)) {
        if (!(device.name === this.local.name && device.deviceId === this.local.deviceId)) devices.push(`${device.name}.${device.deviceId}`);
      }
    }
    return [...new Set(devices)].sort();
  }

  private async refreshGroupMembership(groupJid: string, participants: string[]): Promise<void> {
    const store = this.options.runtime.store as any;
    if (typeof store.getGroupMembershipSnapshot !== "function" || typeof store.setGroupMembershipSnapshot !== "function") return;
    const current = await this.groupMemberDeviceSnapshot(groupJid, participants);
    const previous = store.getGroupMembershipSnapshot(groupJid) as string[] | undefined;
    if (previous && JSON.stringify([...previous].sort()) !== JSON.stringify(current)) {
      await this.groupKeys.syncMembership(groupJid, this.local);
      this.emit("group_membership_changed", { groupJid, previous: [...previous].sort(), current });
    }
    await store.setGroupMembershipSnapshot(groupJid, current);
  }

  private async refreshTrackedGroupMemberships(): Promise<void> {
    const store = this.options.runtime.store as any;
    if (typeof store.listGroupMembershipSnapshots !== "function") return;
    for (const entry of store.listGroupMembershipSnapshots() as Array<{ groupId: string; members: string[] }>) {
      try {
        const participants = await this.getGroupParticipants(entry.groupId);
        await this.refreshGroupMembership(entry.groupId, participants);
      } catch (error) {
        this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async syncGroupMembership(groupJid: string): Promise<void> {
    await this.groupKeys.syncMembership(groupJid, this.local);
    const participants = await this.getGroupParticipants(groupJid);
    const store = this.options.runtime.store as any;
    if (typeof store.setGroupMembershipSnapshot === "function") {
      await store.setGroupMembershipSnapshot(groupJid, await this.groupMemberDeviceSnapshot(groupJid, participants));
    }
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
    const stanza = marshal(encodeNode("message", { to: `${recipient.name}.0@msgr`, id, type: "text" }, [
      encodeNode("participants", {}, [
        encodeNode("to", { jid }, [
          encodeNode("enc", { v: "3", type: typeName }, ciphertext)
        ])
      ])
    ]));
    await this.sendStanzaWithAck(stanza, id);
  }

  private async sendStanzaWithAck(stanza: Buffer, id: string, timeoutMs = 15000): Promise<void> {
    if (this.closed) throw new Error("Messenger E2EE service is closed");
    if (this.pendingMessageAcks.has(id)) throw new Error(`Duplicate outgoing Messenger message ID ${id}`);
    const store = this.options.runtime.store as any;
    if (typeof store.enqueuePendingMessengerMessage === "function") {
      await store.enqueuePendingMessengerMessage(id, Buffer.from(stanza).toString("base64"));
    }
    return new Promise<void>((resolve, reject) => {
      const pending = { resolve, reject, timer: setTimeout(() => {}, 0), stanza: Buffer.from(stanza), attempts: 0 };
      clearTimeout(pending.timer);
      this.pendingMessageAcks.set(id, pending);
      this.transmitPending(id, pending, timeoutMs);
    });
  }

  private transmitPending(
    id: string,
    pending: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; stanza: Buffer; attempts: number },
    timeoutMs: number
  ): void {
    if (this.closed || !this.pendingMessageAcks.has(id)) return;
    if (this.options.reconnect && typeof this.options.socket.isConnected === "function" && !this.options.socket.isConnected()) {
      clearTimeout(pending.timer);
      this.scheduleReconnect();
      return;
    }
    clearTimeout(pending.timer);
    pending.attempts++;
    pending.timer = setTimeout(() => {
      if (pending.attempts < 3) {
        this.transmitPending(id, pending, timeoutMs);
        return;
      }
      this.pendingMessageAcks.delete(id);
      pending.reject(new Error(`Messenger message acknowledgement timed out: ${id}`));
    }, timeoutMs);
    this.options.socket.sendFrame(pending.stanza).catch((error) => {
      clearTimeout(pending.timer);
      if (this.options.reconnect) this.scheduleReconnect();
      else {
        this.pendingMessageAcks.delete(id);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async sendDirectMedia(
    peerId: string,
    media: Uint8Array | Buffer,
    metadata: { fileName?: string; contentType?: string; width?: number; height?: number; seconds?: number; caption?: string; ptt?: boolean } = {}
  ): Promise<{ messageId: string; timestampMs: number; directPath: string; fileEncSHA256: string }> {
    await this.ready;
    if (!/^\\d+$/.test(peerId)) throw new TypeError("Messenger peer ID must be numeric");
    const kind = inferMessengerMediaType(metadata);
    const encrypted = encryptMessengerMedia(media, kind);
    const config = await fetchMessengerMediaUploadConfig(this.options.socket);
    const uploaded = await uploadMessengerMedia(config, encrypted, kind);
    const fields: MessengerMediaFields = {
      ...encrypted.fields, directPath: uploaded.directPath,
      mimeType: metadata.contentType || (kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/ogg" : "application/octet-stream"),
      fileName: metadata.fileName, width: metadata.width, height: metadata.height,
      seconds: metadata.seconds, caption: metadata.caption, ptt: metadata.ptt, objectId: uploaded.objectId
    };
    const { messageApp, frankingTag } = buildMessengerMediaApplication(fields);
    const peerDevices = await this.peers.preparePeer(peerId);
    const ownDevices = await this.directory.listDevices(this.local.name);
    for (const device of ownDevices) if (device.deviceId !== this.local.deviceId) await this.peers.ensureSession(device);
    const all = [...new Map([...peerDevices, ...ownDevices].map((d) => [`${d.name}.${d.deviceId}`, d])).values()]
      .filter((d) => !(d.name === this.local.name && d.deviceId === this.local.deviceId));
    const transport = makeTransport(messageApp);
    const participantNodes: Buffer[] = [];
    for (const device of all) {
      try {
        if (device.name === this.local.name && !this.options.runtime.store.loadSession(device)) continue;
        if (!this.options.runtime.store.loadSession(device)) await this.peers.ensureSession(device);
        const deviceTransport = device.name === this.local.name
          ? makeTransport(messageApp, undefined, { destinationJid: `${peerId}.0@msgr`, phash: "" })
          : transport;
        const encryptedDevice = await this.options.runtime.directMessages.encrypt(device, deviceTransport);
        const typeName = encryptedDevice.type === (this.options.signal as any)?.CiphertextMessageType?.PreKey ? "pkmsg" : "msg";
        participantNodes.push(encodeNode("to", { jid: `${device.name}.${device.deviceId}@msgr` }, [
          encodeNode("enc", { v: "3", type: typeName }, Buffer.from(encryptedDevice.body, "base64"))
        ]));
      } catch (error) { this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))); }
    }
    if (!participantNodes.length) throw new Error("Could not encrypt media for any active Messenger device");
    const id = randomMessageId();
    const stanza = marshal(encodeNode("message", { to: `${peerId}.0@msgr`, type: "text", id }, [
      encodeNode("participants", {}, participantNodes),
      encodeNode("franking", {}, [encodeNode("franking_tag", {}, frankingTag)]),
      encodeNode("trace", {}, [encodeNode("request_id", {}, Buffer.from(randomUUID().replace(/-/g, ""), "hex"))])
    ]));
    await this.sendStanzaWithAck(stanza, id);
    return { messageId: id, timestampMs: Date.now(), directPath: uploaded.directPath, fileEncSHA256: encrypted.fields.fileEncSHA256.toString("base64") };
  }

  async sendGroupMedia(
    groupJid: string,
    media: Uint8Array | Buffer,
    metadata: { fileName?: string; contentType?: string; width?: number; height?: number; seconds?: number; caption?: string; ptt?: boolean } = {}
  ): Promise<{ messageId: string; timestampMs: number; directPath: string; fileEncSHA256: string }> {
    await this.ready;
    if (!groupJid.endsWith("@g.us")) throw new TypeError("A Messenger group JID ending in @g.us is required");
    const participants = await this.getGroupParticipants(groupJid);
    await this.refreshGroupMembership(groupJid, participants);
    const kind = inferMessengerMediaType(metadata);
    const encryptedMedia = encryptMessengerMedia(media, kind);
    const config = await fetchMessengerMediaUploadConfig(this.options.socket);
    const uploaded = await uploadMessengerMedia(config, encryptedMedia, kind);
    const fields: MessengerMediaFields = {
      ...encryptedMedia.fields, directPath: uploaded.directPath,
      mimeType: metadata.contentType || (kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/ogg" : "application/octet-stream"),
      fileName: metadata.fileName, width: metadata.width, height: metadata.height,
      seconds: metadata.seconds, caption: metadata.caption, ptt: metadata.ptt, objectId: uploaded.objectId
    };
    const { messageApp, frankingTag } = buildMessengerMediaApplication(fields);
    const transport = makeTransport(messageApp);
    const encryptedGroup = await this.groupKeys.encrypt(groupJid, this.local, transport);
    const deviceJids: string[] = [];
    for (const member of [...participants, `${this.local.name}.0@msgr`]) {
      const user = jidAddress(member).name;
      for (const device of await this.directory.listDevices(user)) {
        if (!(device.name === this.local.name && device.deviceId === this.local.deviceId)) deviceJids.push(`${device.name}.${device.deviceId}@msgr`);
      }
    }
    const unique = [...new Set(deviceJids)];
    const id = randomMessageId();
    const stanza = marshal(encodeNode("message", { to: groupJid, type: "text", id, phash: participantHash(unique) }, [
      encodeNode("franking", {}, [encodeNode("franking_tag", {}, frankingTag)]),
      encodeNode("trace", {}, [encodeNode("request_id", {}, Buffer.from(randomUUID().replace(/-/g, ""), "hex"))]),
      encodeNode("enc", { v: "3", type: "skmsg" }, Buffer.from(encryptedGroup.body, "base64"))
    ]));
    await this.sendStanzaWithAck(stanza, id);
    return { messageId: id, timestampMs: Date.now(), directPath: uploaded.directPath, fileEncSHA256: encryptedMedia.fields.fileEncSHA256.toString("base64") };
  }

  async downloadMessengerMedia(fields: MessengerMediaFields): Promise<Buffer> {
    await this.ready;
    const config = await fetchMessengerMediaUploadConfig(this.options.socket);
    const url = /^https:\/\//i.test(fields.directPath)
      ? new URL(fields.directPath)
      : new URL(fields.directPath.startsWith("/") ? fields.directPath : `/${fields.directPath}`, `https://${config.host}`);
    const host = url.hostname.toLowerCase();
    if (!["facebook.com", "fbcdn.net", "fbsbx.com", "whatsapp.net"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      throw new Error("Messenger media download host is not allowed");
    }
    if (url.protocol !== "https:") throw new Error("Messenger media download requires HTTPS");
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Messenger media download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024 + 1024) throw new Error("Messenger encrypted media exceeds the 100 MiB download limit");
    return decryptMessengerMedia(bytes, fields);
  }

  receiveDirectMedia(
    envelope: unknown,
    remote: SignalPeerAddress,
    download: (upload: unknown, descriptor: any) => Promise<Uint8Array | Buffer>
  ): Promise<Buffer> {
    return this.directMedia.receive(envelope, remote, download);
  }

  receiveGroupMedia(
    envelope: unknown,
    download: (descriptor: any, upload: unknown) => Promise<Uint8Array | Buffer>,
    expected?: { groupId?: string; sender?: SignalPeerAddress }
  ): Promise<Buffer> {
    return this.groupMedia.receive(envelope, download, expected);
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
        const deviceTransport = device.name === this.local.name
          ? makeTransport(messageApp, undefined, { destinationJid: `${peerId}.0@msgr`, phash: "" })
          : transport;
        const encrypted = await this.options.runtime.directMessages.encrypt(device, deviceTransport);
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
    await this.sendStanzaWithAck(stanza, id);
    return id;
  }

  async sendGroupText(groupJid: string, text: string): Promise<string> {
    if (!groupJid.endsWith("@g.us")) throw new TypeError("A Messenger group JID ending in @g.us is required");
    if (typeof text !== "string" || !text.length) throw new TypeError("E2EE text must be non-empty");
    const participants = await this.getGroupParticipants(groupJid);
    await this.refreshGroupMembership(groupJid, participants);
    const { messageApp, frankingTag } = makeTextApplication(text);
    const transport = makeTransport(messageApp);
    const encrypted = await this.groupKeys.encrypt(groupJid, this.local, transport);
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
    await this.sendStanzaWithAck(stanza, id);
    return id;
  }

  private async sendRetryReceipt(node: Node): Promise<void> {
    const id = String(node.attrs.id || "");
    const to = String(node.attrs.from || "");
    if (!id || !to) return;
    const senderJid = String(node.attrs.participant || to);
    const key = `${to}:${senderJid}:${id}`;
    const count = (this.retryCounts.get(key) || 0) + 1;
    if (count > 2) return;
    this.retryCounts.set(key, count);
    if (this.retryCounts.size > 1000) this.retryCounts.delete(this.retryCounts.keys().next().value as string);

    const registration = Buffer.alloc(4);
    registration.writeUInt32BE(this.options.runtime.registrationId);
    const children: Buffer[] = [
      encodeNode("retry", { count: String(count), id, t: String(node.attrs.t || Math.floor(Date.now() / 1000)), v: "1" }),
      encodeNode("registration", {}, registration)
    ];
    const unpublished = new Set(this.options.runtime.store.listUnpublishedPreKeyIds());
    const oneTime = this.options.runtime.preKeys.find((item) => unpublished.has(item.keyId));
    const signed = this.options.runtime.signedPreKey;
    const raw = (value: string) => {
      const data = Buffer.from(value, "base64");
      return data.length === 33 && data[0] === 0x05 ? data.subarray(1) : data;
    };
    const keyNode = (tag: "key" | "skey", keyId: number, publicKey: string, signature?: string) => {
      const idBytes = Buffer.alloc(3);
      idBytes.writeUIntBE(keyId, 0, 3);
      const nodes = [encodeNode("id", {}, idBytes), encodeNode("value", {}, raw(publicKey))];
      if (signature) nodes.push(encodeNode("signature", {}, Buffer.from(signature, "base64")));
      return encodeNode(tag, {}, nodes);
    };
    const keyChildren: Buffer[] = [
      encodeNode("type", {}, Buffer.from([0x05])),
      encodeNode("identity", {}, raw(this.options.runtime.identityKey))
    ];
    if (oneTime) keyChildren.push(keyNode("key", oneTime.keyId, oneTime.publicKey));
    keyChildren.push(keyNode("skey", signed.keyId, signed.publicKey, signed.signature));
    children.push(encodeNode("keys", {}, keyChildren));

    const attrs: Record<string, string> = { id, to, type: "retry" };
    if (node.attrs.participant || to.endsWith("@g.us")) attrs.participant = senderJid;
    await this.options.socket.sendFrame(marshal(encodeNode("receipt", attrs, children)));
  }

  private dispatchApplicationPayload(
    messageApp: Buffer,
    context: { id: string; threadId: string; senderJid: string; sender: SignalPeerAddress; timestampMs: number },
    group: boolean
  ): void {
    const media = decodeMessengerMediaApplication(messageApp);
    if (media) {
      this.emit(group ? "group_media" : "direct_media", {
        ...context, ...(group ? { groupId: context.threadId } : {}), media
      });
      return;
    }
    const text = decodeText(messageApp);
    if (text !== undefined) this.dispatchApplicationText(text, context, group);
  }

  private dispatchApplicationText(
    text: string,
    context: { id: string; threadId: string; senderJid: string; sender: SignalPeerAddress; timestampMs: number },
    group: boolean
  ): void {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (parsed && typeof parsed === "object") {
      const envelope = parsed as { kind?: unknown; version?: unknown };
      if (envelope.version === 1 && envelope.kind === "direct_media" && !group) {
        this.emit("direct_media", { ...context, envelope: parsed });
        return;
      }
      if (envelope.version === 1 && envelope.kind === "group_media" && group) {
        this.emit("group_media", { ...context, groupId: context.threadId, envelope: parsed });
        return;
      }
    }
    this.emit("message", {
      id: context.id, threadId: context.threadId, senderJid: context.senderJid,
      senderId: context.sender.name, text, timestampMs: context.timestampMs
    } satisfies MessengerE2EEMessageEvent);
  }

  private async handleNode(node: Node): Promise<void> {
    if (node.tag === "ack") {
      const id = String(node.attrs.id || "");
      const pending = this.pendingMessageAcks.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingMessageAcks.delete(id);
        const store = this.options.runtime.store as any;
        if (typeof store.removePendingMessengerMessage === "function") {
          try { await store.removePendingMessengerMessage(id); }
          catch (error) { this.emit("e2ee_error", error instanceof Error ? error : new Error(String(error))); }
        }
        pending.resolve();
      }
      this.emit("ack", node);
      return;
    }
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
        const { publishFacebookPreKeys } = await import("./prekey-publisher.js");
        await publishFacebookPreKeys(this.options.runtime, this.options.socket.sendIQ.bind(this.options.socket));
      }
      this.emit("notification", node);
      return;
    }
    if (node.tag !== "message") { this.emit("raw", node); return; }
    const senderJid = String(node.attrs.participant || node.attrs.from || "");
    const from = String(node.attrs.from || senderJid);
    const sender = jidAddress(senderJid);
    const incomingId = String(node.attrs.id || "");
    if (incomingId && this.seenIncoming.has(incomingId)) {
      await this.options.socket.sendFrame(marshal(encodeNode("ack", { class: "message", id: incomingId, to: from })));
      return;
    }
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
      if (participantPayload.messageApp) {
        this.dispatchApplicationPayload(participantPayload.messageApp, {
          id: String(node.attrs.id || ""),
          threadId: participantPayload.destinationJid || from,
          senderJid, sender,
          timestampMs: Number(node.attrs.t || Date.now()) * 1000
        }, false);
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
      this.dispatchApplicationPayload(decoded.messageApp, {
        id: String(node.attrs.id || ""), threadId: from, senderJid, sender,
        timestampMs: Number(node.attrs.t || Date.now()) * 1000
      }, mainEnc.attrs.type === "skmsg");
    }
    const ackAttrs: Record<string, string> = { class: "message", id: String(node.attrs.id || ""), to: from };
    if (node.attrs.participant) ackAttrs.participant = String(node.attrs.participant);
    await this.options.socket.sendFrame(marshal(encodeNode("ack", ackAttrs)));
    if (incomingId) {
      this.seenIncoming.add(incomingId);
      if (this.seenIncoming.size > 5000) this.seenIncoming.delete(this.seenIncoming.values().next().value as string);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.unsubscribe();
    this.unsubscribeClose();
    for (const [id, pending] of this.pendingMessageAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Messenger E2EE service closed"));
      this.pendingMessageAcks.delete(id);
    }
    this.options.socket.close();
  }
}