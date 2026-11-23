export interface CheckpointDetection {
  detected: boolean;
  url: string;
  reason: string;
}

/** Detect explicit Facebook checkpoint/challenge markers without matching ordinary login text. */
export function detectFacebookCheckpoint(response: Loose): CheckpointDetection {
  const configUrl = String(response && response.config && response.config.url || "");
  const finalUrl = String(
    response && response.request && response.request.res && response.request.res.responseUrl ||
    response && response.request && response.request.responseURL ||
    response && response.responseURL ||
    ""
  );
  const url = finalUrl || configUrl;
  const data = response && response.data !== undefined ? response.data : response;
  let body = "";
  try {
    body = typeof data === "string" ? data : JSON.stringify(data || {});
  } catch {
    body = String(data || "");
  }

  const urlMatch = /(?:^|\/)checkpoint(?:\/|\?|$)|checkpoint_required|challenge_required/i.test(url);
  const bodyMatch = /checkpoint_required|challenge_required|www\.facebook\.com\/checkpoint|\/checkpoint\//i.test(body);
  return {
    detected: urlMatch || bodyMatch,
    url,
    reason: urlMatch ? "facebook_checkpoint_url" : bodyMatch ? "facebook_checkpoint_response" : ""
  };
}
