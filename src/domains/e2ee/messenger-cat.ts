export const FACEBOOK_CAT_GRAPHQL_DOC_ID = "23999698219677129";
const CAT_GRAPHQL_URL = "https://www.facebook.com/api/graphql/";

export interface FacebookCATRequestOptions {
  fbid: string;
  fbDtsg?: string;
  cookies: string;
  userAgent: string;
  request: (form: Record<string, string>) => Promise<unknown>;
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.data === "string") return record.data;
    if (typeof record.body === "string") return record.body;
  }
  throw new Error("Messenger CAT request returned an unsupported response body");
}

/**
 * Fetches the Messenger Crypto Auth Token using the authenticated FCA session.
 * The GraphQL document ID is an unofficial, versioned protocol observation and
 * can change independently of the public FCA API.
 */
export async function fetchFacebookCryptoAuthToken(options: FacebookCATRequestOptions): Promise<string> {
  if (!options || !/^\d+$/.test(String(options.fbid || ""))) {
    throw new TypeError("A numeric Facebook account ID is required to fetch CAT");
  }
  if (!options.fbDtsg?.trim()) throw new Error("Facebook fb_dtsg is required to fetch Messenger CAT");
  if (!options.cookies?.trim() || !options.userAgent?.trim()) {
    throw new Error("Authenticated Facebook cookies and user agent are required to fetch Messenger CAT");
  }
  if (typeof options.request !== "function") throw new TypeError("An authenticated FCA GraphQL request adapter is required");

  const form = {
    fb_dtsg: options.fbDtsg,
    variables: "{}",
    doc_id: FACEBOOK_CAT_GRAPHQL_DOC_ID,
    __user: options.fbid,
    __a: "1",
    __jssesw: "1",
    server_timestamps: "true"
  };
  const raw = responseText(await options.request(form)).replace(/^for\s*\(;;\);\s*/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Messenger CAT GraphQL response was not valid JSON"); }
  const data = parsed && typeof parsed === "object"
    ? (parsed as Record<string, any>).data
    : undefined;
  const token = data?.secure_message_over_wa_cat_query?.encrypted_serialized_cat;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Messenger CAT was missing from the GraphQL response");
  }
  return token;
}
