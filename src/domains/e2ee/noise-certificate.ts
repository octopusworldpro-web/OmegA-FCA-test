import { timingSafeEqual } from "node:crypto";
import { verifyOmegAXEdDSA } from "./xeddsa";

/**
 * Messenger Noise certificate-chain verifier.
 *
 * The certificate structure and pinned WhatsApp/Messenger Noise CA key are
 * cross-checked against the public whatsmeow implementation (MPL-2.0).
 * This implementation validates the complete root -> intermediate -> leaf
 * signature chain, certificate validity windows, issuer serials, and the
 * leaf/static-key binding. It deliberately fails closed on malformed input.
 */
export const MESSENGER_NOISE_ROOT_PUBLIC_KEY = Buffer.from(
  "142375574d0a587166aae71ebe516437c4a28b73e3695c6ce1f7f9545da8ee6b",
  "hex"
);

type ProtoField = { wire: number; bytes?: Buffer; value?: bigint };

function readVarint(input: Buffer, offset: number): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let index = offset;
  while (index < input.length && shift <= 63n) {
    const byte = input[index++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: index };
    shift += 7n;
  }
  throw new Error("Malformed Messenger Noise certificate protobuf varint");
}

function decodeFields(input: Uint8Array): Map<number, ProtoField[]> {
  const bytes = Buffer.from(input);
  const fields = new Map<number, ProtoField[]>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (!Number.isSafeInteger(fieldNumber) || fieldNumber < 1) {
      throw new Error("Invalid Messenger Noise certificate protobuf field");
    }
    let field: ProtoField;
    if (wire === 0) {
      const decoded = readVarint(bytes, offset);
      offset = decoded.offset;
      field = { wire, value: decoded.value };
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      if (length.value > BigInt(bytes.length - offset)) {
        throw new Error("Truncated Messenger Noise certificate protobuf field");
      }
      const end = offset + Number(length.value);
      field = { wire, bytes: Buffer.from(bytes.subarray(offset, end)) };
      offset = end;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (offset + length > bytes.length) throw new Error("Truncated fixed-width certificate field");
      field = { wire, bytes: Buffer.from(bytes.subarray(offset, offset + length)) };
      offset += length;
    } else {
      throw new Error("Unsupported Messenger Noise certificate protobuf wire type");
    }
    const values = fields.get(fieldNumber) || [];
    values.push(field);
    fields.set(fieldNumber, values);
  }
  return fields;
}

function requiredBytes(fields: Map<number, ProtoField[]>, number: number, label: string): Buffer {
  const values = fields.get(number);
  if (!values || values.length !== 1 || values[0].wire !== 2 || !values[0].bytes) {
    throw new Error(`Messenger Noise certificate is missing or duplicates ${label}`);
  }
  return values[0].bytes;
}

function requiredUint(fields: Map<number, ProtoField[]>, number: number, label: string): bigint {
  const values = fields.get(number);
  if (!values || values.length !== 1 || values[0].wire !== 0 || values[0].value === undefined) {
    throw new Error(`Messenger Noise certificate is missing or duplicates ${label}`);
  }
  return values[0].value;
}

interface CertificateDetails {
  serial: bigint;
  issuerSerial: bigint;
  key: Buffer;
  notBefore: bigint;
  notAfter: bigint;
}

function decodeDetails(raw: Buffer, label: string): CertificateDetails {
  const fields = decodeFields(raw);
  const details: CertificateDetails = {
    serial: requiredUint(fields, 1, `${label}.serial`),
    issuerSerial: requiredUint(fields, 2, `${label}.issuerSerial`),
    key: requiredBytes(fields, 3, `${label}.key`),
    notBefore: requiredUint(fields, 4, `${label}.notBefore`),
    notAfter: requiredUint(fields, 5, `${label}.notAfter`)
  };
  if (details.serial > 0xffffffffn || details.issuerSerial > 0xffffffffn ||
      details.key.length !== 32 || details.notBefore > details.notAfter) {
    throw new Error(`Invalid Messenger Noise ${label} certificate details`);
  }
  return details;
}

function assertValidity(details: CertificateDetails, nowSeconds: bigint, label: string): void {
  if (nowSeconds < details.notBefore || nowSeconds > details.notAfter) {
    throw new Error(`Messenger Noise ${label} certificate is outside its validity window`);
  }
}

/** Verifies Messenger's Noise certificate chain and binds its leaf to serverStatic. */
export function verifyMessengerNoiseCertificateChain(
  certificateChain: Uint8Array,
  serverStatic: Uint8Array,
  now = Date.now()
): { serial: number; issuerSerial: number; publicKey: Buffer; notBefore: number; notAfter: number } {
  if (!(certificateChain instanceof Uint8Array) || certificateChain.length === 0) {
    throw new TypeError("Messenger Noise certificate chain is required");
  }
  if (!(serverStatic instanceof Uint8Array) || serverStatic.length !== 32) {
    throw new TypeError("Messenger Noise server static key must be exactly 32 bytes");
  }
  if (!Number.isFinite(now) || now < 0) throw new TypeError("now must be a valid timestamp");

  const chain = decodeFields(Buffer.from(certificateChain));
  const leafRaw = requiredBytes(chain, 1, "leaf");
  const intermediateRaw = requiredBytes(chain, 2, "intermediate");
  const leafCertificate = decodeFields(leafRaw);
  const intermediateCertificate = decodeFields(intermediateRaw);
  const leafDetailsRaw = requiredBytes(leafCertificate, 1, "leaf.details");
  const leafSignature = requiredBytes(leafCertificate, 2, "leaf.signature");
  const intermediateDetailsRaw = requiredBytes(intermediateCertificate, 1, "intermediate.details");
  const intermediateSignature = requiredBytes(intermediateCertificate, 2, "intermediate.signature");

  if (leafSignature.length !== 64 || intermediateSignature.length !== 64) {
    throw new Error("Messenger Noise certificate signatures must be 64 bytes");
  }
  if (!verifyOmegAXEdDSA(MESSENGER_NOISE_ROOT_PUBLIC_KEY, intermediateDetailsRaw, intermediateSignature)) {
    throw new Error("Messenger Noise intermediate certificate root signature verification failed");
  }

  const intermediate = decodeDetails(intermediateDetailsRaw, "intermediate");
  if (intermediate.issuerSerial !== 0n) {
    throw new Error("Messenger Noise intermediate certificate has an unexpected root issuer serial");
  }
  const nowSeconds = BigInt(Math.floor(now / 1000));
  assertValidity(intermediate, nowSeconds, "intermediate");

  if (!verifyOmegAXEdDSA(intermediate.key, leafDetailsRaw, leafSignature)) {
    throw new Error("Messenger Noise leaf certificate signature verification failed");
  }
  const leaf = decodeDetails(leafDetailsRaw, "leaf");
  if (leaf.issuerSerial !== intermediate.serial) {
    throw new Error("Messenger Noise leaf certificate issuer serial mismatch");
  }
  assertValidity(leaf, nowSeconds, "leaf");

  const expectedStatic = Buffer.from(serverStatic);
  if (leaf.key.length !== expectedStatic.length || !timingSafeEqual(leaf.key, expectedStatic)) {
    throw new Error("Messenger Noise leaf certificate key does not match the server static key");
  }

  return {
    serial: Number(leaf.serial),
    issuerSerial: Number(leaf.issuerSerial),
    publicKey: Buffer.from(leaf.key),
    notBefore: Number(leaf.notBefore),
    notAfter: Number(leaf.notAfter)
  };
}
