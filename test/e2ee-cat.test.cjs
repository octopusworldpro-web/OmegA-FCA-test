"use strict";
const assert = require("node:assert/strict");
const { fetchFacebookCryptoAuthToken, FACEBOOK_CAT_GRAPHQL_DOC_ID } = require("../dist/index.js");

(async () => {
  let captured;
  const token = await fetchFacebookCryptoAuthToken({
    fbid: "123456789",
    fbDtsg: "dtsg-test",
    cookies: "c_user=123456789; xs=session",
    userAgent: "OmegA-test",
    request: async (form) => {
      captured = form;
      return { data: 'for (;;);' + JSON.stringify({ data: { secure_message_over_wa_cat_query: { encrypted_serialized_cat: "cat-fixture-value" } } }) };
    }
  });
  assert.equal(token, "cat-fixture-value");
  assert.equal(captured.doc_id, FACEBOOK_CAT_GRAPHQL_DOC_ID);
  assert.equal(captured.__user, "123456789");
  assert.equal(captured.fb_dtsg, "dtsg-test");
  await assert.rejects(fetchFacebookCryptoAuthToken({
    fbid: "123456789", fbDtsg: "", cookies: "c_user=123456789", userAgent: "test", request: async () => ({})
  }), /fb_dtsg/);
  await assert.rejects(fetchFacebookCryptoAuthToken({
    fbid: "123456789", fbDtsg: "x", cookies: "c_user=123456789", userAgent: "test", request: async () => ({ data: "{}" })
  }), /missing from the GraphQL response/);
  console.log("Messenger CAT request/response fixture tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
