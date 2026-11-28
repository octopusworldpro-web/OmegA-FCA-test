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
interface IdentityMetadata { version: 1; accountIdHash: string; encryptionKey: string; localDeviceId: number; }
function loadSignalModule(override?: unknown): Dynamic {
  if (override) return override;
  // Resolve from the installed FCA package, not only the host application's
  // root. This also finds dependencies nested under FCA by npm/pnpm layouts.
  const signalRequire = createRequire(path.join(
    process.cwd(), "node_modules", "@nirzon-islam", "omega-fca", "package.json"
  ));
  try { return signalRequire("@signalapp/libsignal-client"); }
  catch { throw new Error("The optional @signalapp/libsignal-client package is not installed"); }
}

async function readOrCreateMetadata(filePath: string, accountIdHash: string): Promise<IdentityMetadata> {
  const readExisting = async (): Promise<IdentityMetadata> => {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as IdentityMetadata;
    const key = Buffer.from(parsed.encryptionKey, "base64");
    if (parsed.version !== 1 || parsed.accountIdHash !== accountIdHash || key.length !== 32 ||
        !Number.isSafeInteger(parsed.localDeviceId) || parsed.localDeviceId < 1) {
      throw new Error("Invalid E2EE identity metadata");
    }
    return parsed;
  };
  try { return await readExisting(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const metadata: IdentityMetadata = {
    version: 1,
    accountIdHash,
    encryptionKey: randomBytes(32).toString("base64"),
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

/** Creates a persistent, account-isolated local identity configuration. No session credentials are read or stored. */
export async function createE2EEBootstrap(accountId: string, overrides: E2EEBootstrapOptions = {}): Promise<E2EEBootstrap> {
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("A verified account ID is required for E2EE bootstrap");
  const accountIdHash = createHash("sha256").update(accountId.trim()).digest("hex");
  const root = path.resolve(process.env.OMEGA_FCA_DATA_DIR || path.join(process.cwd(), "data"));
  const accountDirectory = path.join(root, "e2ee", accountIdHash);
  await mkdir(accountDirectory, { recursive: true, mode: 0o700 });
  const metadata = await readOrCreateMetadata(path.join(accountDirectory, "identity.json"), accountIdHash);
  const storagePath = overrides.storagePath || path.join(accountDirectory, "signal.store");
  const encryptionKey = overrides.encryptionKey || Buffer.from(metadata.encryptionKey, "base64");
  const localDeviceId = overrides.localDeviceId ?? metadata.localDeviceId;
  if (!Number.isSafeInteger(localDeviceId) || localDeviceId < 1) throw new TypeError("E2EE localDeviceId must be a positive safe integer");
  if (Buffer.isBuffer(encryptionKey) ? encryptionKey.length < 32 : Buffer.byteLength(encryptionKey) < 32) {
    throw new TypeError("E2EE encryptionKey must contain at least 32 bytes");
  }
  return { storagePath, encryptionKey, localDeviceId, signal: loadSignalModule(overrides.signalModule) };
}
