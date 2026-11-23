"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const payloads = [];
  const actions = fca.createSignalE2EEActions({
    encrypt: async (_remote, plaintext) => {
      const body = Buffer.from(plaintext);
      payloads.push(body);
      return { type: 2, body: body.toString("base64") };
    },
    decrypt: async (_remote, ciphertext) => Buffer.from(ciphertext.body, "base64")
  });
  const peer = { name: "peer-1", deviceId: 4 };
  const now = new Date(1700000000000);

  await actions.sendReadReceipt(peer, "thread-1", ["m1", "m2", "m1"], now);
  await actions.sendDeliveryReceipt(peer, "thread-1", ["m3", "m3"], now);
  await actions.sendTyping(peer, "thread-1", true, now);
  await actions.sendTyping(peer, "thread-1", false, now);
  await actions.sendPresence(peer, "away", now);

  const decoded = [];
  for (let i = 0; i < payloads.length; i++) {
    decoded.push(await actions.decryptAction(peer, { type: 2, body: payloads[i].toString("base64") }));
  }
  assert.deepEqual(decoded.map(x => x.kind), ["read_receipt", "delivery_receipt", "typing", "typing", "presence"]);
  assert.deepEqual(decoded[0].messageIDs, ["m1", "m2"]);
  assert.deepEqual(decoded[1].messageIDs, ["m3"]);
  assert.equal(decoded[2].active, true);
  assert.equal(decoded[2].expiresAt - decoded[2].sentAt, 10000);
  assert.equal(decoded[3].active, false);
  assert.equal(decoded[3].expiresAt, decoded[3].sentAt);
  assert.equal(decoded[4].state, "away");
  assert.deepEqual(await actions.decryptReadReceipt(peer, { type: 2, body: payloads[0].toString("base64") }), decoded[0]);

  await assert.rejects(actions.sendDeliveryReceipt(peer, "thread-1", []), /non-empty array/);
  await assert.rejects(actions.sendTyping(peer, "", true, now), /threadID/);
  await assert.rejects(actions.sendTyping(peer, "thread-1", "yes", now), /boolean/);
  await assert.rejects(actions.sendPresence(peer, "invisible", now), /presence state/);
  await assert.rejects(actions.decryptAction(peer, { type: 2, body: Buffer.from(JSON.stringify({
    version: 1, kind: "typing", threadID: "t", active: true, sentAt: 10, expiresAt: 50000
  })).toString("base64") }), /Invalid E2EE typing/);
  await assert.rejects(actions.decryptReadReceipt(peer, { type: 2, body: payloads[1].toString("base64") }), /Invalid E2EE read receipt/);
  console.log("Signal E2EE receipts, typing and presence action tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
