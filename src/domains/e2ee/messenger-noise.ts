import { createCipheriv, createDecipheriv, createHash, hkdfSync } from "node:crypto";
import { deriveOmegAX25519, generateOmegAX25519KeyPair } from "./native-crypto";
import { verifyMessengerNoiseCertificateChain } from "./noise-certificate";

const NOISE_PATTERN = Buffer.from("Noise_XX_25519_AESGCM_SHA256\0\0\0\0");
const WA_HEADER = Buffer.from([0x57, 0x41, 0x06, 0x03]);
const DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export interface MessengerNoiseRawTransport {
  send(data: Buffer): Promise<void> | void;
  read(length: number): Promise<Buffer>;
}
export interface MessengerNoiseHandshakeOptions {
  transport: MessengerNoiseRawTransport;
  staticPrivateKey: Uint8Array;
  fbid: string;
  deviceId: number;
  fbCat: string;
  userAgent?: string;
  now?: number;
  verifyCertificate?: (chain: Uint8Array, serverStatic: Uint8Array, now?: number) => unknown;
}
export interface MessengerNoiseHandshakeResult {
  cipher: MessengerNoiseFrameCipher;
  serverStaticPublicKey: Buffer;
  handshakeHash: Buffer;
}

function varint(value: number | bigint): Buffer {
  let n = BigInt(value);
  if (n < 0n) throw new RangeError("Protobuf varint cannot be negative");
  const bytes: number[] = [];
  while (n > 0x7fn) { bytes.push(Number((n & 0x7fn) | 0x80n)); n >>= 7n; }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}
function fieldVarint(field: number, value: number | bigint): Buffer {
  return Buffer.concat([varint(BigInt((field << 3) | 0)), varint(value)]);
}
function fieldBytes(field: number, value: Uint8Array): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(BigInt((field << 3) | 2)), varint(bytes.length), bytes]);
}
function fieldString(field: number, value: string): Buffer {
  return fieldBytes(field, Buffer.from(value, "utf8"));
}
function encodeLength(data: Buffer): Buffer {
  if (data.length > 0xffffff) throw new RangeError("Messenger Noise handshake frame exceeds 24-bit length");
  const header = Buffer.alloc(3);
  header.writeUIntBE(data.length, 0, 3);
  return Buffer.concat([header, data]);
}
function readVarint(data: Buffer, start: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < data.length && shift <= 28) {
    const byte = data[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new Error("Malformed Messenger Noise handshake protobuf varint");
}
function readBytesField(data: Buffer, target: number): Buffer {
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset); offset = tag.offset;
    const field = tag.value >> 3;
    const wire = tag.value & 7;
    if (wire === 2) {
      const len = readVarint(data, offset); offset = len.offset;
      if (len.value > data.length - offset) throw new Error("Truncated Messenger Noise handshake protobuf field");
      const value = data.subarray(offset, offset + len.value); offset += len.value;
      if (field === target) return Buffer.from(value);
    } else if (wire === 0) {
      offset = readVarint(data, offset).offset;
    } else {
      throw new Error("Unsupported Messenger Noise handshake protobuf wire type");
    }
  }
  throw new Error(`Messenger Noise handshake field ${target} is missing`);
}
async function readFrame(transport: MessengerNoiseRawTransport): Promise<Buffer> {
  const header = await transport.read(3);
  if (!Buffer.isBuffer(header) || header.length !== 3) throw new Error("Messenger Noise socket closed while reading frame header");
  const length = header.readUIntBE(0, 3);
  if (length < 1 || length > 0xffffff) throw new Error("Invalid Messenger Noise frame length");
  const payload = await transport.read(length);
  if (!Buffer.isBuffer(payload) || payload.length !== length) throw new Error("Messenger Noise socket closed during frame payload");
  return payload;
}
function encodeClientHello(ephemeral: Buffer): Buffer {
  return fieldBytes(2, fieldBytes(1, ephemeral));
}
function decodeServerHello(raw: Buffer): { ephemeral: Buffer; encryptedStatic: Buffer; encryptedPayload: Buffer } {
  const hello = readBytesField(raw, 3);
  return {
    ephemeral: readBytesField(hello, 1),
    encryptedStatic: readBytesField(hello, 2),
    encryptedPayload: readBytesField(hello, 3)
  };
}
function encodeClientFinish(encryptedStatic: Buffer, encryptedPayload: Buffer): Buffer {
  return fieldBytes(4, Buffer.concat([fieldBytes(1, encryptedStatic), fieldBytes(2, encryptedPayload)]));
}

export class MessengerNoiseHandshakeState {
  private handshakeHash: Buffer;
  private chainingKey: Buffer;
  private cipherKey: Buffer | null = null;
  private nonce = 0;

  constructor() {
    this.handshakeHash = createHash("sha256").update(NOISE_PATTERN).digest();
    this.chainingKey = Buffer.from(this.handshakeHash);
    this.mixHash(WA_HEADER);
  }
  mixHash(data: Uint8Array): void {
    this.handshakeHash = createHash("sha256").update(Buffer.concat([this.handshakeHash, Buffer.from(data)])).digest();
  }
  mixKey(input: Uint8Array): void {
    const expanded = Buffer.from(hkdfSync("sha256", Buffer.from(input), this.chainingKey, Buffer.alloc(0), 64));
    this.chainingKey = expanded.subarray(0, 32);
    this.cipherKey = expanded.subarray(32, 64);
    this.nonce = 0;
  }
  mixDH(privateKey: Uint8Array, publicKey: Uint8Array): void {
    this.mixKey(deriveOmegAX25519(privateKey, publicKey));
  }
  private buildNonce(): Buffer {
    if (!Number.isSafeInteger(this.nonce) || this.nonce > 0xffffffff) throw new Error("Messenger Noise handshake nonce exhausted");
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32BE(this.nonce++, 8);
    return nonce;
  }
  encrypt(plaintext: Uint8Array): Buffer {
    if (!this.cipherKey) throw new Error("Messenger Noise handshake cipher is not initialized");
    const nonce = this.buildNonce();
    const cipher = createCipheriv("aes-256-gcm", this.cipherKey, nonce);
    cipher.setAAD(this.handshakeHash);
    const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()]);
    this.mixHash(body);
    return body;
  }
  decrypt(ciphertext: Uint8Array): Buffer {
    if (!this.cipherKey) throw new Error("Messenger Noise handshake cipher is not initialized");
    const data = Buffer.from(ciphertext);
    if (data.length < 16) throw new Error("Messenger Noise encrypted handshake field is truncated");
    const nonce = this.buildNonce();
    const decipher = createDecipheriv("aes-256-gcm", this.cipherKey, nonce);
    decipher.setAAD(this.handshakeHash);
    decipher.setAuthTag(data.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
    this.mixHash(data);
    return plaintext;
  }
  finish(): { sendKey: Buffer; receiveKey: Buffer; handshakeHash: Buffer } {
    const expanded = Buffer.from(hkdfSync("sha256", Buffer.alloc(0), this.chainingKey, Buffer.alloc(0), 64));
    return {
      sendKey: Buffer.from(expanded.subarray(0, 32)),
      receiveKey: Buffer.from(expanded.subarray(32, 64)),
      handshakeHash: Buffer.from(this.handshakeHash)
    };
  }
}

export function buildMessengerClientPayload(options: { fbid: string; deviceId: number; fbCat: string; userAgent?: string }): Buffer {
  if (!/^\d+$/.test(String(options.fbid || ""))) throw new TypeError("Messenger account ID must be numeric");
  if (!Number.isSafeInteger(options.deviceId) || options.deviceId < 0) throw new TypeError("Messenger device ID must be a non-negative safe integer");
  if (typeof options.fbCat !== "string" || !options.fbCat) throw new TypeError("Messenger CAT is required");
  const appVersion = Buffer.concat([fieldVarint(1, 301), fieldVarint(2, 0), fieldVarint(3, 2)]);
  const userAgent = Buffer.concat([
    fieldVarint(1, 32), fieldBytes(2, appVersion), fieldString(3, "000"), fieldString(4, "000"),
    fieldString(5, ""), fieldString(6, "Linux"), fieldString(7, "Chrome"), fieldString(8, ""),
    fieldVarint(10, 3), fieldString(11, "en"), fieldString(12, "en")
  ]);
  const ua = options.userAgent || DEFAULT_USER_AGENT;
  return Buffer.concat([
    fieldVarint(1, BigInt(options.fbid)),
    fieldVarint(3, 0),
    fieldBytes(5, userAgent),
    fieldVarint(12, 1),
    fieldVarint(13, 1),
    fieldVarint(18, options.deviceId),
    fieldVarint(20, 1),
    fieldBytes(21, Buffer.from(options.fbCat, "utf8")),
    fieldBytes(22, Buffer.from(ua, "utf8")),
    fieldVarint(33, 1)
  ]);
}

/** AES-GCM framing for the established Messenger Noise socket. No key material is logged. */
export class MessengerNoiseFrameCipher {
  private sendCounter = 0n;
  private receiveCounter = 0n;
  constructor(private readonly sendKey: Uint8Array, private readonly receiveKey: Uint8Array) {
    if (Buffer.from(sendKey).length !== 32 || Buffer.from(receiveKey).length !== 32) {
      throw new TypeError("Messenger Noise transport keys must be 32 bytes");
    }
  }
  private nonce(counter: bigint): Buffer {
    if (counter < 0n || counter > 0xffffffffffffffffn) throw new Error("Messenger Noise frame counter exhausted");
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(counter, 4);
    return nonce;
  }
  encryptFrame(plaintext: Uint8Array): Buffer {
    const nonce = this.nonce(this.sendCounter++);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(this.sendKey), nonce);
    const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()]);
    return encodeLength(body);
  }
  decryptFrame(ciphertext: Uint8Array): Buffer {
    const data = Buffer.from(ciphertext);
    if (data.length < 16) throw new Error("Messenger Noise frame is truncated");
    const nonce = this.nonce(this.receiveCounter++);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(this.receiveKey), nonce);
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  }
  decryptLengthPrefixedFrame(frame: Uint8Array): Buffer {
    const data = Buffer.from(frame);
    if (data.length < 19) throw new Error("Messenger Noise length-prefixed frame is truncated");
    const length = data.readUIntBE(0, 3);
    if (length !== data.length - 3) throw new Error("Messenger Noise frame length does not match payload");
    return this.decryptFrame(data.subarray(3));
  }
}

export async function performMessengerNoiseXXHandshake(
  options: MessengerNoiseHandshakeOptions
): Promise<MessengerNoiseHandshakeResult> {
  if (!options?.transport || typeof options.transport.send !== "function" || typeof options.transport.read !== "function") {
    throw new TypeError("A raw Messenger Noise transport is required");
  }
  const staticPrivate = Buffer.from(options.staticPrivateKey);
  if (staticPrivate.length !== 32) throw new TypeError("Messenger Noise static private key must be 32 bytes");
  if (!/^\d+$/.test(String(options.fbid || ""))) throw new TypeError("Messenger account ID must be numeric");
  const clientPayload = buildMessengerClientPayload({
    fbid: options.fbid,
    deviceId: options.deviceId,
    fbCat: options.fbCat,
    userAgent: options.userAgent
  });
  const state = new MessengerNoiseHandshakeState();
  const ephemeral = generateOmegAX25519KeyPair();
  state.mixHash(ephemeral.publicKey);
  const clientHello = encodeClientHello(ephemeral.publicKey);
  await options.transport.send(Buffer.concat([WA_HEADER, encodeLength(clientHello)]));

  const serverHello = decodeServerHello(await readFrame(options.transport));
  if (serverHello.ephemeral.length !== 32) throw new Error("Messenger Noise server ephemeral key must be 32 bytes");
  state.mixHash(serverHello.ephemeral);
  state.mixDH(ephemeral.privateKey, serverHello.ephemeral);
  const serverStatic = state.decrypt(serverHello.encryptedStatic);
  if (serverStatic.length !== 32) throw new Error("Messenger Noise server static key must be 32 bytes");
  state.mixDH(ephemeral.privateKey, serverStatic);
  const certificateChain = state.decrypt(serverHello.encryptedPayload);
  (options.verifyCertificate || verifyMessengerNoiseCertificateChain)(certificateChain, serverStatic, options.now);

  // The server's certificate binds serverStatic. The client static public key must be
  // supplied by the persistent key store; derive it from the private key using X25519(basepoint).
  const basepoint = Buffer.alloc(32); basepoint[0] = 9;
  const clientStaticPublic = deriveOmegAX25519(staticPrivate, basepoint);
  const encryptedClientStatic = state.encrypt(clientStaticPublic);
  state.mixDH(staticPrivate, serverHello.ephemeral);
  const encryptedPayload = state.encrypt(clientPayload);
  await options.transport.send(encodeLength(encodeClientFinish(encryptedClientStatic, encryptedPayload)));
  const keys = state.finish();
  return {
    cipher: new MessengerNoiseFrameCipher(keys.sendKey, keys.receiveKey),
    serverStaticPublicKey: serverStatic,
    handshakeHash: keys.handshakeHash
  };
}
