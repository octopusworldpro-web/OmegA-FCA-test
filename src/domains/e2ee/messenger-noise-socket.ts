import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { performMessengerNoiseXXHandshake, type MessengerNoiseFrameCipher, type MessengerNoiseRawTransport } from "./messenger-noise";

const DEFAULT_ENDPOINT = "wss://web-chat-e2ee.facebook.com/ws/chat";
const SINGLE_TOKENS = new Map<number, string>([
  [0, ""], [4, "type"], [6, "from"], [8, "id"], [11, "status"], [12, "jid"], [17, "to"], [20, "result"],
  [21, "class"], [22, "xmlns"], [24, "notify"], [25, "iq"], [26, "t"], [29, "enc"],
  [30, "urn:xmpp:whatsapp:push"], [31, "presence"], [43, "urn:xmpp:ping"], [48, "unavailable"],
  [52, "composing"], [59, "device"], [74, "platform"], [76, "success"], [81, "v"], [84, "version"],
  [86, "ping"], [92, "set"], [112, "code"], [113, "list"], [129, "category"], [136, "available"],
  [137, "name"], [156, "identity"], [158, "key"], [168, "error"], [173, "registration"],
  [203, "encrypt"], [212, "signature"]
]);
const DOUBLE_BYTE_TOKENS = new Map<string, string>([
  ["0:46", "reason"], ["1:0", "reject"], ["1:145", "server-error"], ["2:60", "failure"]
]);

interface BinaryNode { tag: string; attrs: Record<string, string>; content?: unknown; }
interface PendingRead { length: number; resolve: (value: Buffer) => void; reject: (error: Error) => void; }

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

class WebSocketByteTransport implements MessengerNoiseRawTransport {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private readers: PendingRead[] = [];
  private closedError: Error | null = null;

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (chunk.length) { this.chunks.push(chunk); this.buffered += chunk.length; this.flush(); }
    });
    ws.on("close", () => this.fail(new Error("Messenger Noise WebSocket closed")));
    ws.on("error", (error) => this.fail(error instanceof Error ? error : new Error("Messenger Noise WebSocket error")));
  }
  async send(data: Buffer): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("Messenger Noise WebSocket is not open");
    await new Promise<void>((resolve, reject) => this.ws.send(data, { binary: true }, (error) => error ? reject(error) : resolve()));
  }
  read(length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffff) return Promise.reject(new RangeError("Invalid raw Messenger Noise read length"));
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.buffered >= length) return Promise.resolve(this.take(length));
    return new Promise<Buffer>((resolve, reject) => this.readers.push({ length, resolve, reject }));
  }
  private take(length: number): Buffer {
    const out = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const first = this.chunks[0];
      const count = Math.min(first.length, length - offset);
      first.copy(out, offset, 0, count);
      offset += count;
      this.buffered -= count;
      if (count === first.length) this.chunks.shift();
      else this.chunks[0] = first.subarray(count);
    }
    return out;
  }
  private flush(): void {
    while (this.readers.length && this.buffered >= this.readers[0].length) {
      const reader = this.readers.shift()!;
      reader.resolve(this.take(reader.length));
    }
  }
  private fail(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const reader of this.readers.splice(0)) reader.reject(error);
  }
}

function readVarint(data: Buffer, cursor: { offset: number }): number {
  let value = 0;
  let shift = 0;
  while (cursor.offset < data.length && shift <= 28) {
    const byte = data[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return value;
    shift += 7;
  }
  throw new Error("Malformed Messenger binary node varint");
}
function readString(data: Buffer, cursor: { offset: number }): string {
  if (cursor.offset >= data.length) throw new Error("Truncated Messenger binary node string");
  const token = data[cursor.offset++];
  if (token >= 236 && token <= 239) {
    if (cursor.offset >= data.length) throw new Error("Truncated Messenger double-byte token");
    const index = data[cursor.offset++];
    const value = DOUBLE_BYTE_TOKENS.get(`${token - 236}:${index}`);
    if (value === undefined) throw new Error(`Unsupported Messenger double-byte token ${token - 236}:${index}`);
    return value;
  }
  if (token < 236) {
    const value = SINGLE_TOKENS.get(token);
    if (value === undefined) throw new Error(`Unsupported Messenger binary token ${token}`);
    return value;
  }
  if (token === 250) {
    const user = readString(data, cursor);
    const server = readString(data, cursor);
    return user && server ? `${user}@${server}` : (user || server);
  }
  if (token === 251) {
    if (cursor.offset >= data.length) throw new Error("Truncated Messenger hex8 length");
    const length = data[cursor.offset++];
    if (cursor.offset + length > data.length) throw new Error("Truncated Messenger hex8 value");
    const value = data.subarray(cursor.offset, cursor.offset + length).toString("hex");
    cursor.offset += length;
    return value;
  }
  if (token === 255) {
    if (cursor.offset >= data.length) throw new Error("Truncated Messenger nibble8 length");
    const length = data[cursor.offset++];
    const byteLength = Math.ceil(length / 2);
    if (cursor.offset + byteLength > data.length) throw new Error("Truncated Messenger nibble8 value");
    const alphabet = "0123456789-.";
    let value = "";
    for (let i = 0; i < byteLength; i++) {
      const byte = data[cursor.offset++];
      for (const nibble of [byte >> 4, byte & 15]) {
        if (value.length >= length) break;
        if (nibble >= alphabet.length) throw new Error("Invalid Messenger nibble8 digit");
        value += alphabet[nibble];
      }
    }
    return value;
  }
  if (token === 252) {
    if (cursor.offset >= data.length) throw new Error("Truncated Messenger binary8 length");
    const length = data[cursor.offset++];
    if (cursor.offset + length > data.length) throw new Error("Truncated Messenger binary8 value");
    const value = data.toString("utf8", cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return value;
  }
  if (token === 253) {
    if (cursor.offset + 3 > data.length) throw new Error("Truncated Messenger binary20 length");
    const length = (data[cursor.offset] << 16) | (data[cursor.offset + 1] << 8) | data[cursor.offset + 2];
    cursor.offset += 3;
    if (cursor.offset + length > data.length) throw new Error("Truncated Messenger binary20 value");
    const value = data.toString("utf8", cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return value;
  }
  if (token === 254) {
    if (cursor.offset + 4 > data.length) throw new Error("Truncated Messenger binary32 length");
    const length = data.readUInt32BE(cursor.offset); cursor.offset += 4;
    if (length > data.length - cursor.offset) throw new Error("Truncated Messenger binary32 value");
    const value = data.toString("utf8", cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return value;
  }
  throw new Error(`Unsupported Messenger binary string token ${token}`);
}
function readListSize(data: Buffer, cursor: { offset: number }): number {
  if (cursor.offset >= data.length) throw new Error("Messenger binary node list is missing");
  const token = data[cursor.offset++];
  if (token === 0) return 0;
  if (token === 248) {
    if (cursor.offset >= data.length) throw new Error("Truncated Messenger list8");
    return data[cursor.offset++];
  }
  if (token === 249) {
    if (cursor.offset + 2 > data.length) throw new Error("Truncated Messenger list16");
    const size = data.readUInt16BE(cursor.offset); cursor.offset += 2; return size;
  }
  throw new Error(`Unsupported Messenger binary list token ${token}`);
}
function readNode(data: Buffer, cursor: { offset: number }): BinaryNode {
  const size = readListSize(data, cursor);
  if (size < 1 || size > 255) throw new Error("Invalid Messenger binary node size");
  const tag = readString(data, cursor);
  const hasContent = ((size - 1) % 2) === 1;
  const attributeCount = Math.floor((size - 1) / 2);
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < attributeCount; i++) {
    const key = readString(data, cursor);
    if (Object.prototype.hasOwnProperty.call(attrs, key)) throw new Error(`Duplicate Messenger node attribute: ${key}`);
    attrs[key] = readString(data, cursor);
  }
  let content: unknown;
  if (hasContent) {
    if (cursor.offset >= data.length) throw new Error("Messenger binary node content is missing");
    const marker = data[cursor.offset];
    if (marker === 0 || marker === 248 || marker === 249) {
      const childCount = readListSize(data, cursor);
      const children: BinaryNode[] = [];
      for (let i = 0; i < childCount; i++) children.push(readNode(data, cursor));
      content = children;
    } else {
      content = readString(data, cursor);
    }
  }
  return { tag, attrs, content };
}

/** Decode one complete WA-binary node, including arbitrarily nested child nodes. */
export function decodeMessengerBinaryNode(frame: Uint8Array): BinaryNode {
  const data = Buffer.from(frame);
  const cursor = { offset: 0 };
  if (data[0] === 0) cursor.offset++;
  const node = readNode(data, cursor);
  if (cursor.offset !== data.length) throw new Error("Unexpected trailing Messenger binary node bytes");
  return node;
}

export interface MessengerNoiseSocketOptions {
  staticPrivateKey: Uint8Array;
  fbid: string;
  deviceId: number;
  fbCat: string;
  userAgent?: string;
  endpoint?: string;
  timeoutMs?: number;
}
export class MessengerNoiseSocket {
  private readonly events = new EventEmitter();
  private readonly pendingIQ = new Map<string, { resolve: (node: BinaryNode) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private dispatchTask: Promise<void> | null = null;
  private readonly bufferedNodes: BinaryNode[] = [];
  private closedError: Error | null = null;
  private constructor(
    private readonly ws: WebSocket,
    private readonly raw: WebSocketByteTransport,
    private readonly cipher: MessengerNoiseFrameCipher,
    readonly handshakeHash: Buffer
  ) {
    ws.once("close", () => this.stop(new Error("Messenger Noise WebSocket closed")));
    ws.once("error", (error) => this.stop(error instanceof Error ? error : new Error("Messenger Noise WebSocket error")));
  }
  static async connect(options: MessengerNoiseSocketOptions): Promise<MessengerNoiseSocket> {
    const endpoint = options.endpoint || DEFAULT_ENDPOINT;
    const userAgent = options.userAgent || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    const socketUrl = new URL(endpoint);
    if (!socketUrl.searchParams.has("cid")) socketUrl.searchParams.set("cid", `client-${Date.now()}`);
    const ws = new WebSocket(socketUrl.toString(), {
      headers: { Origin: "https://www.facebook.com", "User-Agent": userAgent },
      handshakeTimeout: options.timeoutMs || 15000,
      perMessageDeflate: false
    });
    const raw = new WebSocketByteTransport(ws);
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      }), options.timeoutMs || 15000, "Messenger Noise WebSocket open");
      const handshake = await withTimeout(performMessengerNoiseXXHandshake({
        transport: raw,
        staticPrivateKey: options.staticPrivateKey,
        fbid: options.fbid,
        deviceId: options.deviceId,
        fbCat: options.fbCat,
        userAgent
      }), options.timeoutMs || 15000, "Messenger Noise XX handshake");
      const socket = new MessengerNoiseSocket(ws, raw, handshake.cipher, handshake.handshakeHash);
      await socket.waitForSuccess(options.timeoutMs || 15000);
      socket.startDispatcher();
      return socket;
    } catch (error) {
      ws.close();
      throw error;
    }
  }
  isConnected(): boolean { return this.ws.readyState === WebSocket.OPEN && !this.closedError; }
  async sendFrame(payload: Uint8Array): Promise<void> {
    if (!this.isConnected()) throw this.closedError || new Error("Messenger Noise socket is disconnected");
    await this.raw.send(this.cipher.encryptFrame(payload));
  }
  async readFrame(timeoutMs = 15000): Promise<Buffer> {
    const header = await withTimeout(this.raw.read(3), timeoutMs, "Messenger Noise frame header");
    const length = header.readUIntBE(0, 3);
    if (length < 16 || length > 0xffffff) throw new Error("Invalid Messenger Noise encrypted frame length");
    const encrypted = await withTimeout(this.raw.read(length), timeoutMs, "Messenger Noise frame payload");
    return this.cipher.decryptFrame(encrypted);
  }
  async waitForSuccess(timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const node = decodeMessengerBinaryNode(await this.readFrame(Math.max(1, deadline - Date.now())));
      if (node.tag === "success") return;
      if (node.tag === "failure") throw new Error(`Messenger E2EE login rejected: ${node.attrs.reason || node.attrs.type || "unknown reason"}`);
      this.bufferedNodes.push(node);
    }
    throw new Error("Messenger E2EE login success acknowledgement timed out");
  }
  private startDispatcher(): void {
    if (this.dispatchTask) return;
    this.dispatchTask = (async () => {
      while (this.isConnected()) {
        const node = decodeMessengerBinaryNode(await this.readFrame());
        if (node.tag === "failure") throw new Error(`Messenger E2EE server failure: ${node.attrs.reason || node.attrs.type || "unknown reason"}`);
        if (node.tag === "iq" && node.attrs.id) {
          const pending = this.pendingIQ.get(node.attrs.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingIQ.delete(node.attrs.id);
            if (node.attrs.type === "error") pending.reject(new Error(`Messenger IQ ${node.attrs.id} returned an error`));
            else pending.resolve(node);
            continue;
          }
        }
        // Non-correlated IQs and message/presence/receipt nodes are never discarded.
        this.events.emit("node", node);
      }
    })().catch((error) => this.stop(error instanceof Error ? error : new Error(String(error))));
  }
  private stop(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const [id, pending] of this.pendingIQ) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingIQ.delete(id);
    }
    this.events.emit("close", error);
  }
  onNode(listener: (node: BinaryNode) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Messenger node listener must be a function");
    this.events.on("node", listener);
    return () => this.events.off("node", listener);
  }
  onceNode(listener: (node: BinaryNode) => void): void {
    if (typeof listener !== "function") throw new TypeError("Messenger node listener must be a function");
    this.events.once("node", listener);
  }
  onClose(listener: (error: Error) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Messenger close listener must be a function");
    this.events.on("close", listener);
    if (this.closedError) listener(this.closedError);
    return () => this.events.off("close", listener);
  }
  sendIQ(stanza: Buffer, id: string, timeoutMs = 15000): Promise<BinaryNode> {
    if (!id) return Promise.reject(new TypeError("Messenger IQ correlation ID is required"));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new RangeError("Messenger IQ timeout must be positive"));
    if (this.pendingIQ.has(id)) return Promise.reject(new Error(`Messenger IQ ${id} is already pending`));
    if (!this.isConnected()) return Promise.reject(this.closedError || new Error("Messenger Noise socket is disconnected"));
    return new Promise<BinaryNode>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIQ.delete(id);
        reject(new Error(`Messenger IQ ${id} acknowledgement timed out`));
      }, timeoutMs);
      this.pendingIQ.set(id, { resolve, reject, timer });
      this.sendFrame(stanza).catch((error) => {
        const pending = this.pendingIQ.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingIQ.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
  close(): void {
    this.stop(new Error("Messenger Noise socket closed by client"));
    if (this.ws.readyState !== WebSocket.CLOSED) this.ws.close();
  }
}

export async function connectMessengerNoiseSocket(options: MessengerNoiseSocketOptions): Promise<MessengerNoiseSocket> {
  return MessengerNoiseSocket.connect(options);
}
