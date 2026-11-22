import type { MqttRequestClient } from "../contracts/request";

export interface PublishLsRequestOptions<TResult> {
  client: MqttRequestClient | null | undefined;
  content: Record<string, Loose>;
  requestId: number;
  topic?: string;
  responseTopic?: string;
  timeoutMs?: number;
  extract: (message: Record<string, Loose>) => TResult;
}

/** Publish one /ls_req and resolve only its matching /ls_resp. All listeners/timers are removed on every exit path. */
export async function publishLsRequestWithAck<TResult>(params: PublishLsRequestOptions<TResult>): Promise<TResult> {
  const {
    client, content, requestId, topic = "/ls_req",
    responseTopic = "/ls_resp", timeoutMs = 15000, extract
  } = params;

  if (!client || typeof client.on !== "function" ||
      typeof client.publish !== "function" ||
      typeof client.removeListener !== "function") {
    throw new Error("MQTT client is not initialized");
  }
  if (!Number.isSafeInteger(requestId) || requestId < 0) {
    throw new Error("A valid MQTT request ID is required");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("MQTT acknowledgement timeout must be a positive number");
  }

  const emitter = client as Loose;
  return new Promise<TResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      emitter.removeListener("message", onMessage);
      emitter.removeListener("error", onError);
      emitter.removeListener("close", onClose);
      emitter.removeListener("offline", onOffline);
      emitter.removeListener("end", onEnd);
    };

    const settle = (handler: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };

    const onMessage = (incomingTopic: string, rawMessage: Buffer | string) => {
      if (incomingTopic !== responseTopic) return;
      let parsed: Record<string, Loose>;
      try {
        const raw = Buffer.isBuffer(rawMessage) ? rawMessage.toString() : String(rawMessage);
        parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
        if (typeof parsed.payload === "string") parsed.payload = JSON.parse(parsed.payload);
      } catch {
        return;
      }
      if (String(parsed.request_id) !== String(requestId)) return;
      settle(() => {
        try {
          resolve(extract(parsed));
        } catch (error) {
          reject(error);
        }
      });
    };

    const onError = (error: Loose) => settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    const onClose = () => settle(() => reject(new Error("MQTT connection closed before acknowledgement")));
    const onOffline = () => settle(() => reject(new Error("MQTT connection went offline before acknowledgement")));
    const onEnd = () => settle(() => reject(new Error("MQTT connection ended before acknowledgement")));

    emitter.on("message", onMessage);
    emitter.on("error", onError);
    emitter.on("close", onClose);
    emitter.on("offline", onOffline);
    emitter.on("end", onEnd);
    timer = setTimeout(() => settle(() => reject(new Error("Timeout waiting for ACK"))), timeoutMs);

    try {
      client.publish(topic, JSON.stringify(content), { qos: 1, retain: false }, (error?: Loose) => {
        if (error) onError(error);
      });
    } catch (error) {
      onError(error);
    }
  });
}
