export interface MqttClientLifecycleContext {
  mqttClient?: {
    removeAllListeners?: () => unknown;
    end?: (force?: boolean) => unknown;
  } | null;
}

/** Detach and force-close a previous MQTT client before replacing it. */
export function disposePreviousMqttClient(
  ctx: MqttClientLifecycleContext,
  logger: (message: string, type?: string) => void = () => {}
): boolean {
  const previous = ctx.mqttClient;
  if (!previous) return false;

  try {
    if (typeof previous.removeAllListeners === "function") previous.removeAllListeners();
  } catch (error) {
    logger("mqtt previous client listener cleanup failed: " + String(error), "warn");
  }

  try {
    // Force end even when the MQTT client never reached the connected state.
    if (typeof previous.end === "function") previous.end(true);
  } catch (error) {
    logger("mqtt previous client close failed: " + String(error), "warn");
  }

  if (ctx.mqttClient === previous) ctx.mqttClient = undefined;
  return true;
}
