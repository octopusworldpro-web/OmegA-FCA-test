import { createE2EEBootstrap, type E2EEBootstrapOptions } from "./bootstrap";
import { createSignalE2EERuntime, type SignalE2EERuntime } from "./runtime";
import { FACEBOOK_E2EE_APP_ID, registerFacebookE2EEDevice, type FacebookE2EERegistrationResult } from "./device-registration";
import { publishFacebookPreKeys, type FacebookE2EESendIQ } from "./prekey-publisher";
import { fetchFacebookCryptoAuthToken } from "./messenger-cat";
import { connectMessengerNoiseSocket, type MessengerNoiseSocket } from "./messenger-noise-socket";
import { MessengerE2EEService } from "./messenger-e2ee-service";

export interface E2EELoginOptions extends E2EEBootstrapOptions {
  enabled?: boolean;
  signedPreKeyId?: number;
  facebook?: { appId?: string; fbCat?: string; deviceId?: string; force?: boolean; sendIQ?: FacebookE2EESendIQ } | false;
}
export type E2EELoginResult =
  | { status: "disabled"; runtime: null }
  | { status: "ready"; runtime: SignalE2EERuntime; deviceRegistration?: FacebookE2EERegistrationResult; preKeyPublication?: { id: string; uploaded: number }; noiseSocket?: MessengerNoiseSocket; messenger?: MessengerE2EEService }
  | { status: "failed"; runtime: null; error: string };
export interface E2EELoginFactories {
  bootstrap?: typeof createE2EEBootstrap;
  runtime?: typeof createSignalE2EERuntime;
  registerDevice?: typeof registerFacebookE2EEDevice;
  fetchCAT?: typeof fetchFacebookCryptoAuthToken;
  connectNoise?: typeof connectMessengerNoiseSocket;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface E2EELoginSession {
  cookies?: string;
  userAgent?: string;
  fbDtsg?: string;
  requestCAT?: (form: Record<string, string>) => Promise<unknown>;
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
  let noiseSocket: MessengerNoiseSocket | null = null;
  let messenger: MessengerE2EEService | null = null;
  let reconnectNoise: (() => Promise<MessengerNoiseSocket>) | undefined;
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
    // E2EE opt-in enables the authenticated Messenger transport by default.
    // Set facebook: false only for callers that explicitly need local Signal storage without Messenger.
    const facebookOptions = options.facebook === false ? undefined : (options.facebook || {});
    if (facebookOptions) {
      const registerDevice = factories.registerDevice || registerFacebookE2EEDevice;
      if (!session.cookies?.trim() || !session.userAgent?.trim()) {
        throw new Error("Facebook ICDC registration requires the authenticated cookie header and user agent");
      }
      const fetchCAT = factories.fetchCAT || fetchFacebookCryptoAuthToken;
      const catOptions = {
        fbid: accountId,
        fbDtsg: session.fbDtsg,
        cookies: session.cookies,
        userAgent: session.userAgent,
        request: session.requestCAT || (async () => { throw new Error("Authenticated FCA CAT request adapter is unavailable"); })
      };
      let fbCat = facebookOptions.fbCat || await fetchCAT(catOptions);
      deviceRegistration = await registerDevice({
        fbid: accountId,
        fbCat,
        appId: facebookOptions.appId || FACEBOOK_E2EE_APP_ID,
        cookies: session.cookies,
        userAgent: session.userAgent,
        signal: bootstrap.signal,
        store: runtime.store,
        signedPreKeyId: runtime.signedPreKey.keyId,
        deviceId: facebookOptions.deviceId,
        force: facebookOptions.force
      });
      runtime.setLocalDeviceId(deviceRegistration.waDeviceId);
      if (facebookOptions.sendIQ) {
        preKeyPublication = await publishFacebookPreKeys(runtime, options.facebook.sendIQ);
      } else {
        const persistedNoiseKey = runtime.store.getNoiseKeyPair();
        if (!persistedNoiseKey) throw new Error("Persisted Messenger Noise identity is missing");
        const connectNoise = factories.connectNoise || connectMessengerNoiseSocket;
        const wait = factories.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
        let connectedNoiseSocket: MessengerNoiseSocket | undefined;
        for (let attempt = 0; attempt < 3 && !connectedNoiseSocket; attempt++) {
          try {
            connectedNoiseSocket = await connectNoise({
              staticPrivateKey: Buffer.from(persistedNoiseKey.privateKey, "base64"),
              fbid: accountId,
              deviceId: deviceRegistration.waDeviceId,
              fbCat,
              userAgent: session.userAgent
            });
          } catch (connectError) {
            const message = connectError instanceof Error ? connectError.message : String(connectError);
            const retryable = /timed out|websocket|socket|econn|enotfound|network|temporar|http 5\d\d/i.test(message);
            if (!retryable || attempt === 2) throw connectError;
            if (!options.facebook.fbCat) fbCat = await fetchCAT(catOptions);
            await wait(250 * (attempt + 1));
          }
        }
        if (!connectedNoiseSocket) throw new Error("Messenger Noise connection could not be established");
        noiseSocket = connectedNoiseSocket;
        preKeyPublication = await publishFacebookPreKeys(runtime, connectedNoiseSocket.sendIQ.bind(connectedNoiseSocket));
        reconnectNoise = async () => {
          let refreshedCAT: string;
          try { refreshedCAT = await fetchCAT(catOptions); }
          catch (error) {
            if (!facebookOptions?.fbCat) throw error;
            refreshedCAT = options.facebook.fbCat;
          }
          const replacement = await connectNoise({
            staticPrivateKey: Buffer.from(persistedNoiseKey.privateKey, "base64"),
            fbid: accountId,
            deviceId: deviceRegistration!.waDeviceId,
            fbCat: refreshedCAT,
            userAgent: session.userAgent
          });
          try {
            await publishFacebookPreKeys(runtime, replacement.sendIQ.bind(replacement));
            return replacement;
          } catch (error) {
            replacement.close();
            throw error;
          }
        };
      }
      if (noiseSocket && deviceRegistration && typeof noiseSocket.onNode === "function" && typeof noiseSocket.onClose === "function") {
        messenger = new MessengerE2EEService({
          accountId,
          localDeviceId: deviceRegistration.waDeviceId,
          runtime,
          socket: noiseSocket,
          signal: bootstrap.signal,
          reconnect: reconnectNoise
        });
        await messenger.ready;
      }
    }
    return { status: "ready", runtime, deviceRegistration, preKeyPublication, noiseSocket: noiseSocket || undefined, messenger: messenger || undefined };
  } catch (error) {
    if (messenger) messenger.close();
    else if (noiseSocket) noiseSocket.close();
    if (initializedRuntime) await initializedRuntime.close().catch(() => undefined);
    return {
      status: "failed",
      runtime: null,
      error: error instanceof Error ? error.message : "E2EE initialization failed"
    };
  }
}
