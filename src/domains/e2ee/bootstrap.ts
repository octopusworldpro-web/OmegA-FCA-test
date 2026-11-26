import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

type Dynamic = any;
export interface E2EEBootstrapOptions {
  storagePath?: string;
  encryptionKey?: string | Buffer;
  localDeviceId?: number;
  signalModule?: unknown;
}
export interface E2EEBootstrap {
  storagePath: string;
  encryptionKey: string | Buffer;
  localDeviceId: number;
  signal: Dynamic;
}
interface IdentityMetadata { version: 2; accountIdHash: string; localDeviceId: number; }
const signalRequire = createRequire(path.join(process.cwd(), "package.json"));

function loadSignalModule(override?: unknown): Dynamic {
  if (override) return override;
  try { return signalRequire("@signalapp/libsignal-client"); }
  catch { throw new Error("The optional @signalapp/libsignal-client package is not installed"); }
}

async function readOrCreateMetadata(filePath: string, accountIdHash: string): Promise<IdentityMetadata> {
  const readExisting = async (): Promise<IdentityMetadata> => {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as IdentityMetadata & { encryptionKey?: string };
    if (parsed.version === 1 && typeof parsed.encryptionKey === "string") {
      throw new Error("Legacy E2EE metadata stores its encryption key in plaintext. Back up the old Signal store and migrate metadata before enabling E2EE.");
    }
    if (parsed.version !== 2 || parsed.accountIdHash !== accountIdHash ||
        !Number.isSafeInteger(parsed.localDeviceId) || parsed.localDeviceId < 1) {
      throw new Error("Invalid E2EE identity metadata");
    }
    return parsed;
  };
  try { return await readExisting(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const metadata: IdentityMetadata = {
    version: 2,
    accountIdHash,
    localDeviceId: randomBytes(4).readUInt32BE(0) % 2147483646 + 1
  };
  const handle = await open(filePath, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") return null;
    throw error;
  });
  if (!handle) return readExisting();
  try { await handle.writeFile(JSON.stringify(metadata), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  return metadata;
}

/** Creates account-scoped metadata; the encryption key is externally supplied and never persisted here. */
export async function createE2EEBootstrap(accountId: string, overrides: E2EEBootstrapOptions = {}): Promise<E2EEBootstrap> {
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("A verified account ID is required for E2EE bootstrap");
  const accountIdHash = createHash("sha256").update(accountId.trim()).digest("hex");
  const root = path.resolve(process.env.OMEGA_FCA_DATA_DIR || path.join(process.cwd(), "data"));
  const accountDirectory = path.join(root, "e2ee", accountIdHash);
  await mkdir(accountDirectory, { recursive: true, mode: 0o700 });
  const metadata = await readOrCreateMetadata(path.join(accountDirectory, "identity.json"), accountIdHash);
  const storagePath = overrides.storagePath || path.join(accountDirectory, "signal.store");
  const encryptionKey = overrides.encryptionKey || process.env.OMEGA_FCA_E2EE_MASTER_KEY;
  if (!encryptionKey || (Buffer.isBuffer(encryptionKey) ? encryptionKey.length : Buffer.byteLength(encryptionKey)) < 32) {
    throw new TypeError("Set OMEGA_FCA_E2EE_MASTER_KEY to a stable secret of at least 32 bytes, or provide e2ee.encryptionKey. The key is never saved to disk.");
  }
  const localDeviceId = overrides.localDeviceId ?? metadata.localDeviceId;
  if (!Number.isSafeInteger(localDeviceId) || localDeviceId < 1) throw new TypeError("E2EE localDeviceId must be a positive safe integer");
  return { storagePath, encryptionKey, localDeviceId, signal: loadSignalModule(overrides.signalModule) };
}
