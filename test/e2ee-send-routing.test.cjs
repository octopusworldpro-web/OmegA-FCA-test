"use strict";
const assert = require("node:assert/strict");
const { createE2EESendMessageRouter } = require("../dist/index.js");

(async () => {
  const legacyCalls = [];
  const directCalls = [];
  const send = createE2EESendMessageRouter(
    async (...args) => { legacyCalls.push(args); return { legacy: true }; },
    {
      isE2EEThread: (threadID) => threadID === "123456789",
      sendDirectText: async (peerID, text) => {
        directCalls.push({ peerID, text });
        return "e2ee-message-1";
      }
    }
  );

  const legacyResult = await send("ordinary", "987654321");
  assert.deepEqual(legacyResult, { legacy: true });
  assert.equal(legacyCalls.length, 1, "non-E2EE messages retain the legacy MQTT path");

  const directResult = await send("!ping", "123456789");
  assert.deepEqual(directResult, {
    body: "!ping", messageID: "e2ee-message-1", threadID: "123456789", isE2EE: true
  });
  assert.deepEqual(directCalls, [{ peerID: "123456789", text: "!ping" }]);

  let callbackResult;
  const objectResult = await send({ body: "hello" }, "123456789", (_error, result) => {
    callbackResult = result;
  });
  assert.equal(objectResult.messageID, "e2ee-message-1");
  assert.equal(callbackResult.isE2EE, true, "Node-style callbacks receive the encrypted send result");

  await assert.rejects(
    send({ body: "photo", attachment: Buffer.from("x") }, "123456789"),
    /plaintext fallback is disabled/
  );
  await assert.rejects(
    send({ sticker: "1" }, "123456789"),
    /text payloads only/
  );
  assert.equal(legacyCalls.length, 1, "unsupported E2EE payloads must never fall back to MQTT");
  console.log("E2EE send routing tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
