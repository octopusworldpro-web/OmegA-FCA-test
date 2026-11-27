const DEFAULT_MQTT_HOST = "edge-chat.facebook.com";

export interface MqttWebSocketUrlOptions {
  endpoint?: string | null;
  region?: string | null;
  sessionId: string | number;
  clientId: string;
}

/** Build a Facebook MQTT WebSocket URL without corrupting existing query parameters. */
export function buildMqttWebSocketUrl(options: MqttWebSocketUrlOptions): string {
  const sessionId = String(options.sessionId);
  const clientId = String(options.clientId || "");
  if (!/^\d+$/.test(sessionId) || !clientId) {
    throw new TypeError("A numeric MQTT session id and client id are required");
  }

  const fallback = new URL("wss://" + DEFAULT_MQTT_HOST + "/chat");
  if (options.region) fallback.searchParams.set("region", String(options.region).toLowerCase());

  let url = fallback;
  if (options.endpoint) {
    try {
      const candidate = new URL(options.endpoint);
      const isFacebookHost = candidate.hostname === "facebook.com" ||
        candidate.hostname.endsWith(".facebook.com");
      if (!isFacebookHost || (candidate.protocol !== "wss:" && candidate.protocol !== "https:")) {
        throw new TypeError("Rejected non-Facebook or non-secure MQTT endpoint");
      }
      candidate.protocol = "wss:";
      url = candidate;
    } catch (error) {
      if (error instanceof TypeError && error.message.startsWith("Rejected")) throw error;
      throw new TypeError("Invalid Facebook MQTT endpoint");
    }
  }

  url.hash = "";
  url.searchParams.set("sid", sessionId);
  url.searchParams.set("cid", clientId);
  return url.toString();
}

export function getMqttWebSocketHost(url: string): string {
  return new URL(url).host;
}
