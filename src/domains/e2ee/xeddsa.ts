import { createHash } from "node:crypto";

const P = (1n << 255n) - 19n;
const Q = (1n << 252n) + 27742317777372353535851937790883648493n;
const D = mod(-121665n * inv(121666n));
const ZERO = 0n;
const ONE = 1n;
type Point = { x: bigint; y: bigint };

function mod(value: bigint): bigint { const r = value % P; return r < ZERO ? r + P : r; }
function pow(base: bigint, exponent: bigint): bigint {
  let x = mod(base), n = exponent, out = ONE;
  while (n > ZERO) { if (n & ONE) out = mod(out * x); x = mod(x * x); n >>= ONE; }
  return out;
}
function inv(value: bigint): bigint { if (mod(value) === ZERO) throw new Error("XEdDSA inverse of zero"); return pow(value, P - 2n); }
function fromLE(bytes: Uint8Array): bigint {
  let n = ZERO;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}
function toLE(value: bigint, length: number): Buffer {
  let n = value, out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function encode(point: Point): Buffer {
  const out = toLE(point.y, 32);
  out[31] |= Number(point.x & ONE) << 7;
  return out;
}
function decode(encoded: Uint8Array): Point | null {
  if (encoded.length !== 32) return null;
  const bytes = Buffer.from(encoded);
  const sign = bytes[31] >>> 7;
  bytes[31] &= 0x7f;
  const y = fromLE(bytes);
  if (y >= P) return null;
  const y2 = mod(y * y);
  const x2 = mod((y2 - ONE) * inv(D * y2 + ONE));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== ZERO) x = mod(x * pow(2n, (P - 1n) / 4n));
  if (mod(x * x - x2) !== ZERO) return null;
  if (Number(x & ONE) !== sign) x = mod(-x);
  if (Number(x & ONE) !== sign) return null;
  return { x, y };
}
function add(a: Point, b: Point): Point {
  const product = mod(D * a.x * b.x * a.y * b.y);
  return {
    x: mod((a.x * b.y + a.y * b.x) * inv(ONE + product)),
    y: mod((a.y * b.y + a.x * b.x) * inv(ONE - product))
  };
}
function negate(point: Point): Point { return { x: mod(-point.x), y: point.y }; }
function multiply(point: Point, scalar: bigint): Point {
  let n = scalar, addend = point, result: Point = { x: ZERO, y: ONE };
  while (n > ZERO) {
    if (n & ONE) result = add(result, addend);
    addend = add(addend, addend);
    n >>= ONE;
  }
  return result;
}
function montgomeryToEdwards(u: bigint): Point | null {
  if (u < ZERO || u >= P || u === P - ONE) return null;
  const y = mod((u - ONE) * inv(u + ONE));
  return decode(toLE(y, 32));
}
const BASE = montgomeryToEdwards(9n)!;

/**
 * Verify a Curve25519 XEdDSA signature using the XEdDSA revision-1 encoding
 * and verification equation. This handles public inputs only; it does not sign.
 */
export function verifyOmegAXEdDSA(
  identityMontgomeryPublicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    if (!(identityMontgomeryPublicKey instanceof Uint8Array) ||
        !(message instanceof Uint8Array) || !(signature instanceof Uint8Array) ||
        identityMontgomeryPublicKey.length !== 32 || signature.length !== 64) return false;
    const u = fromLE(identityMontgomeryPublicKey);
    if (u >= P) return false;
    const publicPoint = montgomeryToEdwards(u);
    if (!publicPoint) return false;
    const encodedR = Buffer.from(signature.subarray(0, 32));
    const rPoint = decode(encodedR);
    if (!rPoint) return false;
    const s = fromLE(signature.subarray(32, 64));
    // XEdDSA revision 1 rejects excess 256-bit values, but does not require s < q.
    if (s >= (1n << 256n)) return false;
    const encodedA = encode(publicPoint);
    const hInput = Buffer.concat([encodedR, encodedA, Buffer.from(message)]);
    const h = fromLE(createHash("sha512").update(hInput).digest()) % Q;
    const calculated = add(multiply(BASE, s), negate(multiply(publicPoint, h)));
    return equal(encode(calculated), encodedR);
  } catch {
    return false;
  }
}
