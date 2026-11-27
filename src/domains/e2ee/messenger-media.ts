import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { encodeNode, marshal, type Node } from "./messenger-binary";
import type { MessengerNoiseSocket } from "./messenger-noise-socket";

export type MessengerMediaType = "image" | "video" | "audio" | "document";
export interface MessengerMediaFields {
  kind: MessengerMediaType;
  mediaKey: Buffer;
  fileSHA256: Buffer;
  fileEncSHA256: Buffer;
  fileLength: number;
  directPath: string;
  mimeType: string;
  objectId?: string;
  mediaKeyTimestamp: number;
  fileName?: string;
  width?: number;
  height?: number;
  seconds?: number;
  caption?: string;
  ptt?: boolean;
}
export interface EncryptedMessengerMedia {
  fields: MessengerMediaFields;
  uploadBytes: Buffer;
}
export interface MessengerMediaUploadConfig { host: string; auth: string; ttl?: number; authTtl?: number; fetchedAtMs: number; }
export interface MessengerMediaUploadResult { directPath: string; url?: string; handle?: string; objectId?: string; }

const HKDF_INFO: Record<MessengerMediaType, string> = {
  image: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
  document: "WhatsApp Document Keys"
};
const MAC_LENGTH = 10;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function deriveKeys(mediaKey: Buffer, kind: MessengerMediaType): { iv: Buffer; cipherKey: Buffer; macKey: Buffer } {
  if (mediaKey.length !== 32) throw new TypeError("Messenger media_key must be exactly 32 bytes");
  const expanded = Buffer.from(hkdfSync("sha256", mediaKey, Buffer.alloc(0), HKDF_INFO[kind], 80));
  return {
    iv: expanded.subarray(0, 16),
    cipherKey: expanded.subarray(16, 48),
    macKey: expanded.subarray(48, 80)
  };
}

export function encryptMessengerMedia(dataInput: Uint8Array, kind: MessengerMediaType): EncryptedMessengerMedia {
  const data = Buffer.from(dataInput);
  if (data.length > MAX_MEDIA_BYTES) throw new RangeError("Messenger E2EE media exceeds the 100 MiB local limit");
  const mediaKey = randomBytes(32);
  const { iv, cipherKey, macKey } = deriveKeys(mediaKey, kind);
  const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const mac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, MAC_LENGTH);
  const uploadBytes = Buffer.concat([ciphertext, mac]);
  return {
    fields: {
      kind, mediaKey,
      fileSHA256: createHash("sha256").update(data).digest(),
      fileEncSHA256: createHash("sha256").update(uploadBytes).digest(),
      fileLength: data.length, directPath: "", mimeType: "application/octet-stream",
      mediaKeyTimestamp: Math.floor(Date.now() / 1000)
    },
    uploadBytes
  };
}

export function decryptMessengerMedia(uploadBytesInput: Uint8Array, fields: Pick<MessengerMediaFields, "kind" | "mediaKey" | "fileSHA256" | "fileEncSHA256" | "fileLength">): Buffer {
  const uploadBytes = Buffer.from(uploadBytesInput);
  if (uploadBytes.length <= MAC_LENGTH || uploadBytes.length > MAX_MEDIA_BYTES + 1024) throw new Error("Messenger encrypted media size is invalid");
  const digest = createHash("sha256").update(uploadBytes).digest();
  if (!digest.equals(fields.fileEncSHA256)) throw new Error("Messenger encrypted media SHA-256 mismatch");
  const ciphertext = uploadBytes.subarray(0, -MAC_LENGTH);
  const actualMac = uploadBytes.subarray(-MAC_LENGTH);
  const { iv, cipherKey, macKey } = deriveKeys(Buffer.from(fields.mediaKey), fields.kind);
  const expectedMac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, MAC_LENGTH);
  if (!expectedMac.equals(actualMac)) throw new Error("Messenger encrypted media HMAC mismatch");
  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length !== fields.fileLength) throw new Error("Messenger media plaintext length mismatch");
  if (!createHash("sha256").update(plaintext).digest().equals(fields.fileSHA256)) throw new Error("Messenger media plaintext SHA-256 mismatch");
  return plaintext;
}

function toUploadToken(hash: Buffer): string {
  return hash.toString("base64").replace(/\\+/g, "-").replace(/\\//g, "_");
}
function child(node: Node | undefined, tag: string): Node | undefined {
  if (!node) return undefined;
  if (node.tag === tag) return node;
  if (Array.isArray(node.content)) for (const item of node.content as Node[]) { const found = child(item, tag); if (found) return found; }
  return undefined;
}
function children(node: Node | undefined): Node[] { return Array.isArray(node?.content) ? node.content as Node[] : []; }
function textAttr(node: Node | undefined, key: string): string { return String(node?.attrs?.[key] || ""); }

export async function fetchMessengerMediaUploadConfig(socket: MessengerNoiseSocket): Promise<MessengerMediaUploadConfig> {
  const id = "omega-media-" + randomBytes(8).toString("hex");
  const iq = marshal(encodeNode("iq", { id, to: "s.whatsapp.net", type: "set", xmlns: "w:m" }, [encodeNode("media_conn", {})]));
  const response = await socket.sendIQ(iq, id, 12000) as Node;
  const mediaConn = child(response, "media_conn");
  if (!mediaConn) throw new Error("Messenger media_conn response is missing");
  const hosts = children(mediaConn).filter((item) => item.tag === "host").map((item) => textAttr(item, "hostname")).filter(Boolean);
  const host = hosts.at(-1) || "";
  const auth = textAttr(mediaConn, "auth");
  if (!host || !auth || !/^[a-z0-9.-]+$/i.test(host)) throw new Error("Messenger media_conn returned an invalid host or auth token");
  return { host, auth, ttl: Number(mediaConn.attrs.ttl) || undefined, authTtl: Number(mediaConn.attrs.auth_ttl) || undefined, fetchedAtMs: Date.now() };
}

export async function uploadMessengerMedia(
  config: MessengerMediaUploadConfig,
  encrypted: EncryptedMessengerMedia,
  kind: MessengerMediaType
): Promise<MessengerMediaUploadResult> {
  const mmsType = kind === "audio" ? "ptt" : kind;
  const token = toUploadToken(encrypted.fields.fileEncSHA256);
  const url = `https://${config.host}/wa-msgr/mms/${mmsType}/${token}?auth=${encodeURIComponent(config.auth)}&token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(encrypted.uploadBytes.length), "Origin": "https://www.facebook.com", "Referer": "https://www.facebook.com/" },
    body: encrypted.uploadBytes
  });
  if (!response.ok) throw new Error(`Messenger encrypted media upload failed: HTTP ${response.status}`);
  const result = await response.json() as Record<string, unknown>;
  const directPath = String(result.direct_path ?? result.directPath ?? "");
  if (!directPath) throw new Error("Messenger media upload response is missing direct_path");
  return { directPath, url: typeof result.url === "string" ? result.url : undefined, handle: typeof result.handle === "string" ? result.handle : undefined, objectId: String(result.object_id ?? result.objectId ?? "") || undefined };
}

class ProtoWriter {
  private chunks: Buffer[] = [];
  private varint(value: number | bigint): Buffer {
    let n = BigInt(value); if (n < 0n) throw new RangeError("negative protobuf varint");
    const out: number[] = []; while (n > 127n) { out.push(Number((n & 127n) | 128n)); n >>= 7n; } out.push(Number(n)); return Buffer.from(out);
  }
  private head(field: number, wire: number): Buffer { return this.varint(BigInt(field * 8 + wire)); }
  var(field: number, value: number | bigint): this { this.chunks.push(this.head(field, 0), this.varint(value)); return this; }
  bytes(field: number, value: Uint8Array): this { const b = Buffer.from(value); this.chunks.push(this.head(field, 2), this.varint(b.length), b); return this; }
  string(field: number, value: string): this { return this.bytes(field, Buffer.from(value)); }
  bool(field: number, value: boolean): this { return this.var(field, value ? 1 : 0); }
  build(): Buffer { return Buffer.concat(this.chunks); }
}

export function buildMessengerMediaApplication(fields: MessengerMediaFields): { messageApp: Buffer; frankingTag: Buffer } {
  const commonIntegral = new ProtoWriter()
    .bytes(1, fields.fileSHA256).bytes(2, fields.mediaKey).bytes(3, fields.fileEncSHA256)
    .string(4, fields.directPath).var(5, fields.mediaKeyTimestamp).build();
  let commonAncillary = new ProtoWriter().var(1, fields.fileLength).string(2, fields.mimeType);
  if (fields.objectId) commonAncillary = commonAncillary.string(4, fields.objectId);
  const common = new ProtoWriter().bytes(1, commonIntegral).bytes(2, commonAncillary.build()).build();
  const mediaIntegral = new ProtoWriter().bytes(1, common).build();
  let mediaAncillary = new ProtoWriter();
  let mediaTransport: Buffer;
  let contentField: number;
  let wrapper: ProtoWriter;
  if (fields.kind === "image") {
    if (fields.width !== undefined) mediaAncillary = mediaAncillary.var(2, fields.width);
    if (fields.height !== undefined) mediaAncillary = mediaAncillary.var(1, fields.height);
    mediaTransport = new ProtoWriter().bytes(1, mediaIntegral).bytes(2, mediaAncillary.build()).build();
    contentField = 2; wrapper = new ProtoWriter().bytes(1, new ProtoWriter().bytes(1, mediaTransport).var(2, 1).build());
    if (fields.caption) wrapper.bytes(2, new ProtoWriter().string(1, fields.caption).build());
  } else if (fields.kind === "video") {
    if (fields.seconds !== undefined) mediaAncillary = mediaAncillary.var(1, fields.seconds);
    mediaAncillary = mediaAncillary.bool(3, false);
    if (fields.height !== undefined) mediaAncillary = mediaAncillary.var(4, fields.height);
    if (fields.width !== undefined) mediaAncillary = mediaAncillary.var(5, fields.width);
    mediaTransport = new ProtoWriter().bytes(1, mediaIntegral).bytes(2, mediaAncillary.build()).build();
    contentField = 9; wrapper = new ProtoWriter().bytes(1, new ProtoWriter().bytes(1, mediaTransport).var(2, 1).build());
    if (fields.caption) wrapper.bytes(2, new ProtoWriter().string(1, fields.caption).build());
  } else if (fields.kind === "audio") {
    if (fields.seconds !== undefined) mediaAncillary = mediaAncillary.var(1, fields.seconds);
    mediaTransport = new ProtoWriter().bytes(1, mediaIntegral).bytes(2, mediaAncillary.build()).build();
    contentField = 8; wrapper = new ProtoWriter().bytes(1, new ProtoWriter().bytes(1, mediaTransport).var(2, 1).build());
    if (fields.ptt) wrapper.bool(2, true);
  } else {
    mediaTransport = new ProtoWriter().bytes(1, mediaIntegral).bytes(2, Buffer.alloc(0)).build();
    contentField = 7; wrapper = new ProtoWriter().bytes(1, new ProtoWriter().bytes(1, mediaTransport).var(2, 1).build());
    if (fields.fileName) wrapper.string(2, fields.fileName);
    if (fields.caption) wrapper.string(3, fields.caption);
  }
  const content = new ProtoWriter().bytes(contentField, wrapper.build()).build();
  const payload = new ProtoWriter().bytes(1, content).build();
  const consumer = new ProtoWriter().bytes(1, payload).build();
  const consumerSub = new ProtoWriter().bytes(1, consumer).var(2, 1).build();
  const subProtocol = new ProtoWriter().var(1, 0).bytes(2, consumerSub).build();
  const appPayload = new ProtoWriter().bytes(4, subProtocol).build();
  const frankingKey = randomBytes(32);
  const metadata = new ProtoWriter().bytes(8, frankingKey).var(9, 0).build();
  const messageApp = new ProtoWriter().bytes(1, appPayload).bytes(2, metadata).build();
  return { messageApp, frankingTag: createHmac("sha256", frankingKey).update(messageApp).digest() };
}
