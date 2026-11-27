import { createE2EEBootstrap, type E2EEBootstrapOptions } from "./bootstrap";
import { createSignalE2EERuntime, type SignalE2EERuntime } from "./runtime";
import { registerFacebookE2EEDevice, type FacebookE2EERegistrationResult } from "./device-registration";
import { publishFacebookPreKeys, type FacebookE2EESendIQ } from "./prekey-publisher";

export interface E2EELoginOptions extends E2EEBootstrapOptions {
  enabled?: boolean;
  signedPreKeyId?: number;
  facebook?: { appId: string; fbCat: string; deviceId?: string; force?: boolean; sendIQ?: FacebookE2EESendIQ };
}
export type E2EELoginResult =
  | { status: "disabled"; runtime: null }
  | { status: "ready"; runtime: SignalE2EERuntime; deviceRegistration?: FacebookE2EERegistrationResult; preKeyPublication?: { id: string; uploaded: number } }
  | { status: "failed"; runtime: null; error: string };
export interface E2EELoginFactories {
  bootstrap?: typeof createE2EEBootstrap;
  runtime?: typeof createSignalE2EERuntime;
  registerDevice?: typeof registerFacebookE2EEDevice;
}
export interface E2EELoginSession {
  cookies?: string;
  userAgent?: string;
}

/** Initialize the local Signal runtime only after FCA has authenticated the account. */
export async function initializeE2EEForLogin(
  accountId: string,
  options: E2EELoginOptions | undefined,
  factories: E2EELoginFactories = {},
  session: E2EELoginSession = {}
): Promise<E2EELoginResult> {
  if (!options?.enabled) return { status: "disabled", runtime: null };
  let initializedRuntime: SignalE2EERuntime | null = null;
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
    initializedRuntime = runtime;
    let deviceRegistration: FacebookE2EERegistrationResult | undefined;
    let preKeyPublication: { id: string; uploaded: number } | undefined;
    if (options.facebook) {
      const registerDevice = factories.registerDevice || registerFacebookE2EEDevice;
      if (!session.cookies?.trim() || !session.userAgent?.trim()) {
        throw new Error("Facebook ICDC registration requires the authenticated cookie header and user agent");
      }
      deviceRegistration = await registerDevice({
        fbid: accountId,
        fbCat: options.facebook.fbCat,
        appId: options.facebook.appId,
        cookies: session.cookies,
        userAgent: session.userAgent,
        signal: bootstrap.signal,
        store: runtime.store,
        signedPreKeyId: runtime.signedPreKey.keyId,
        deviceId: options.facebook.deviceId,
        force: options.facebook.force
      });
      if (options.facebook.sendIQ) {
        preKeyPublication = await publishFacebookPreKeys(runtime, options.facebook.sendIQ);
      }
    }
    return { status: "ready", runtime, deviceRegistration, preKeyPublication };
  } catch (error) {
    if (initializedRuntime) await initializedRuntime.close().catch(() => undefined);
    return {
      status: "failed",
      runtime: null,
      error: error instanceof Error ? error.message : "E2EE initialization failed"
    };
  }
}
