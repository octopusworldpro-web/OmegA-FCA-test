import { createE2EEBootstrap, type E2EEBootstrapOptions } from "./bootstrap";
import { createSignalE2EERuntime, type SignalE2EERuntime } from "./runtime";

export interface E2EELoginOptions extends E2EEBootstrapOptions {
  enabled?: boolean;
  signedPreKeyId?: number;
}
export type E2EELoginResult =
  | { status: "disabled"; runtime: null }
  | { status: "ready"; runtime: SignalE2EERuntime }
  | { status: "failed"; runtime: null; error: string };
export interface E2EELoginFactories {
  bootstrap?: typeof createE2EEBootstrap;
  runtime?: typeof createSignalE2EERuntime;
}

/** Initialize the local Signal runtime only after FCA has authenticated the account. */
export async function initializeE2EEForLogin(
  accountId: string,
  options: E2EELoginOptions | undefined,
  factories: E2EELoginFactories = {}
): Promise<E2EELoginResult> {
  if (!options?.enabled) return { status: "disabled", runtime: null };
  try {
    const bootstrapFactory = factories.bootstrap || createE2EEBootstrap;
    const runtimeFactory = factories.runtime || createSignalE2EERuntime;
    const bootstrap = await bootstrapFactory(accountId, {
      storagePath: options.storagePath,
      encryptionKey: options.encryptionKey,
      localDeviceId: options.localDeviceId,
      signalModule: options.signalModule
    });
    const runtime = await runtimeFactory({
      accountId,
      storagePath: bootstrap.storagePath,
      encryptionKey: bootstrap.encryptionKey,
      localDeviceId: bootstrap.localDeviceId,
      signedPreKeyId: options.signedPreKeyId,
      signal: bootstrap.signal
    });
    return { status: "ready", runtime };
  } catch (error) {
    return {
      status: "failed",
      runtime: null,
      error: error instanceof Error ? error.message : "E2EE initialization failed"
    };
  }
}
