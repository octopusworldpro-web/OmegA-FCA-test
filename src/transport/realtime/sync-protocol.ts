export interface MqttSubscriptionGrant {
  topic: string;
  qos: number;
}

export function validateMqttSubscriptionAck(
  topics: readonly string[],
  error?: Error | null,
  granted?: readonly MqttSubscriptionGrant[] | null
): { ok: boolean; reason?: string } {
  if (error) return { ok: false, reason: error.message || String(error) };
  if (!Array.isArray(granted)) return { ok: false, reason: "MQTT SUBACK did not include granted topics" };
  const grants = new Map(granted.map((item) => [item.topic, item.qos]));
  for (const topic of topics) {
    const qos = grants.get(topic);
    if (qos === undefined) return { ok: false, reason: `MQTT SUBACK omitted topic ${topic}` };
    if (qos === 128) return { ok: false, reason: `MQTT subscription rejected for ${topic}` };
    if (qos !== 0 && qos !== 1 && qos !== 2) return { ok: false, reason: `MQTT SUBACK returned invalid QoS for ${topic}` };
  }
  return { ok: true };
}

export function normalizeMqttSequenceId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeMqttSyncState(
  message: Record<string, Loose>,
  current: { lastSeqId?: number; syncToken?: string }
): { lastSeqId?: number; syncToken?: string } {
  const next: { lastSeqId?: number; syncToken?: string } = {};
  const first = normalizeMqttSequenceId(message.firstDeltaSeqId);
  const last = normalizeMqttSequenceId(message.lastIssuedSeqId);
  if (first !== null) next.lastSeqId = first;
  if (last !== null) next.lastSeqId = last;
  const token = message.syncToken;
  if (typeof token === "string" && token.length > 0) next.syncToken = token;
  return {
    lastSeqId: next.lastSeqId ?? current.lastSeqId,
    syncToken: next.syncToken ?? current.syncToken
  };
}

export function buildInitialMqttSyncQueue(ctx: {
  userID: string;
  lastSeqId?: number;
  syncToken?: string;
}): { topic: string; payload: Record<string, Loose> } {
  const payload: Record<string, Loose> = {
    sync_api_version: 11,
    max_deltas_able_to_process: 100,
    delta_batch_size: 500,
    encoding: "JSON",
    entity_fbid: ctx.userID,
    initial_titan_sequence_id: ctx.lastSeqId ?? 0,
    device_params: null
  };
  if (ctx.syncToken) {
    payload.last_seq_id = ctx.lastSeqId ?? 0;
    payload.sync_token = ctx.syncToken;
  }
  return {
    topic: ctx.syncToken ? "/messenger_sync_get_diffs" : "/messenger_sync_create_queue",
    payload
  };
}
