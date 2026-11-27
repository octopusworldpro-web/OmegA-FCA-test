"use strict";
const assert = require("node:assert/strict");
const { buildFacebookPreKeyUpload, publishFacebookPreKeys } = require("../dist/index.js");

const key = (fill) => Buffer.concat([Buffer.from([0x05]), Buffer.alloc(32, fill)]).toString("base64");
const runtime = {
  registrationId: 12345,
  identityKey: key(1),
  signedPreKey: { keyId: 7, publicKey: key(2), signature: Buffer.alloc(64, 3).toString("base64") },
  preKeys: Array.from({ length: 25 }, (_, i) => ({ keyId: i + 1, publicKey: key(i + 10) }))
};

(async () => {
  const stanza = buildFacebookPreKeyUpload(runtime, "pk-test");
  assert.equal(stanza[0], 0, "WA-binary stanza has uncompressed data-type prefix");
  for (const field of ["iq", "s.whatsapp.net", "encrypt", "registration", "identity", "list", "key", "skey", "signature"]) {
    assert.ok(stanza.includes(Buffer.from(field)), `stanza contains ${field}`);
  }
  assert.ok(stanza.includes(Buffer.from([0, 0, 0x30, 0x39])), "registration ID is encoded as uint32 big-endian");
  assert.ok(stanza.includes(Buffer.alloc(32, 1)), "identity public key is normalized to raw 32-byte form");
  assert.ok(stanza.includes(Buffer.alloc(32, 2)), "signed prekey is normalized to raw 32-byte form");

  let sent;
  const result = await publishFacebookPreKeys(runtime, async (payload, id) => {
    sent = { payload, id };
    return { tag: "iq", attrs: { id, type: "result" } };
  });
  assert.equal(result.uploaded, 25);
  assert.equal(sent.id, result.id);
  assert.ok(sent.payload.equals(buildFacebookPreKeyUpload(runtime, sent.id)));

  await assert.rejects(
    publishFacebookPreKeys(runtime, async (_payload, id) => ({ tag: "iq", attrs: { id, type: "error" } })),
    /rejected or did not acknowledge/
  );
  await assert.rejects(
    publishFacebookPreKeys(runtime, async () => null),
    /rejected or did not acknowledge/
  );
  assert.throws(() => buildFacebookPreKeyUpload({ ...runtime, preKeys: [] }), /one-time prekey is required/);
  console.log("Messenger WA-binary prekey upload construction and IQ acknowledgement tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
