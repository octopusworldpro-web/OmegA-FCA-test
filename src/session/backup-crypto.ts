import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "omega-fca:enc:v1:";
const KEY_ENV = "OMEGA_FCA_SESSION_BACKUP_KEY";

function readKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) throw new Error(`${KEY_ENV} is required to encrypt session backups`);
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error(`${KEY_ENV} must be a 32-byte base64 value or 64-character hex value`);
  }
  return decoded;
}

function aad(userID: string, type: string): Buffer {
  return Buffer.from(`omega-fca|session-backup|v1|${userID}|${type}`, "utf8");
}

export function encryptSessionBackup(plaintext: string, userID: string, type: string): string {
  if (!/^\d+$/.test(userID) || !userID || !["appstate", "cookie"].includes(type)) {
    throw new Error("Invalid session backup identity or type");
  }
  const key = readKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(userID, type));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64")
  };
  return PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptSessionBackup(payload: string, userID: string, type: string): string | null {
  if (!payload.startsWith(PREFIX)) {
    if (process.env.OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS === "true") return payload;
    return null;
  }
  if (!/^\d+$/.test(userID) || !userID || !["appstate", "cookie"].includes(type)) return null;
  try {
    const envelope = JSON.parse(Buffer.from(payload.slice(PREFIX.length), "base64").toString("utf8"));
    if (envelope?.v !== 1) return null;
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.data, "base64");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", readKey(), iv);
    decipher.setAAD(aad(userID, type));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function isEncryptedSessionBackup(payload: string): boolean {
  return payload.startsWith(PREFIX);
}
