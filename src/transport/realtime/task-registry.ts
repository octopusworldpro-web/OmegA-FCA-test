export type MqttTaskResponseMapper = (type: string, payload: Record<string, Loose>) => Loose;

/** Consume a pending MQTT request exactly once before invoking its callback. */
export function consumeMqttTaskResponse(
  tasks: Map<Loose, Loose> | null | undefined,
  requestId: Loose,
  payload: Record<string, Loose>,
  mapResponse: MqttTaskResponseMapper
): boolean {
  if (!(tasks instanceof Map) || !tasks.has(requestId)) return false;
  const task = tasks.get(requestId);
  tasks.delete(requestId);
  if (!task || task.completed || typeof task.callback !== "function") return true;
  task.completed = true;
  const response = mapResponse(task.type, payload);
  if (response == null) task.callback("error", null);
  else task.callback(null, Object.assign({ type: task.type, reqID: requestId }, response));
  return true;
}
