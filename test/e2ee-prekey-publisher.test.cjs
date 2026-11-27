"use strict";
const assert = require("node:assert/strict");
const { buildFacebookPreKeyUpload, publishFacebookPreKeys } = require("../dist/index.js");

const key = (fill) => Buffer.concat([Buffer.from([0x05]), Buffer.alloc(32, fill)]).toString("base64");
const runtime = {
  registrationId: 12345,
  identityKey: key(1),
  signedPreKey: { keyId: 7, publicKey: key(2), signature: Buffer.alloc(64, 3).toString("base64") },
  preKeys: Array.from({ length: 25 }, (_, i) => ({ keyId: i + 1, publicKey: key(i + 10) })),
  store: (() => {
    const published = new Set();
    let signedPublished = false;
    return {
      listUnpublishedPreKeyIds: () => Array.from({ length: 25 }, (_, i) => i + 1).filter((id) => !published.has(id)),
      markPreKeysPublished: async (ids) => ids.forEach((id) => published.add(id)),
      isSignedPreKeyPublished: () => signedPublished,
      markSignedPreKeyPublished: async () => { signedPublished = true; }
    };
  })()
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
  const skipped = await publishFacebookPreKeys(runtime, async () => {
    throw new Error("acknowledged keys must not be uploaded twice");
  });
  assert.deepEqual(skipped, { id: "", uploaded: 0, skipped: true });

  const makeUnpublishedRuntime = () => ({
    ...runtime,
    store: (() => {
      const pending = new Set();
      let signed = false;
      return {
        listUnpublishedPreKeyIds: () => runtime.preKeys.map((item) => item.keyId).filter((id) => !pending.has(id)),
        markPreKeysPublished: async (ids) => ids.forEach((id) => pending.add(id)),
        isSignedPreKeyPublished: () => signed,
        markSignedPreKeyPublished: async () => { signed = true; }
      };
    })()
  });
  await assert.rejects(
    publishFacebookPreKeys(makeUnpublishedRuntime(), async (_payload, id) => ({ tag: "iq", attrs: { id, type: "error" } })),
    /rejected or did not acknowledge/
  );
  await assert.rejects(
    publishFacebookPreKeys(makeUnpublishedRuntime(), async () => null),
    /rejected or did not acknowledge/
  );
  const signedOnly = buildFacebookPreKeyUpload({ ...runtime, preKeys: [] }, "pk-signed-only");
  assert.ok(signedOnly.includes(Buffer.from("skey")), "signed-prekey rotation can be published without re-uploading old one-time keys");

  // Concurrent login/recovery attempts must serialize for one account store.
  const acknowledged = new Set();
  let signedAcknowledged = false;
  const partialRuntime = {
    ...runtime,
    preKeys: [runtime.preKeys[0]],
    store: {
      listUnpublishedPreKeyIds: () => [1, 2].filter((id) => !acknowledged.has(id)),
      markPreKeysPublished: async (ids) => ids.forEach((id) => acknowledged.add(id)),
      isSignedPreKeyPublished: () => signedAcknowledged,
      markSignedPreKeyPublished: async () => { signedAcknowledged = true; }
    }
  };
  let sends = 0;
  const send = async (_payload, id) => {
    sends += 1;
    await Promise.resolve();
    return { tag: "iq", attrs: { id, type: "result" } };
  };
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    publishFacebookPreKeys(partialRuntime, send),
    publishFacebookPreKeys(partialRuntime, send)
  ]);
  assert.equal(sends, 1, "concurrent publication must not send duplicate IQs");
  assert.equal(firstConcurrent.uploaded + secondConcurrent.uploaded, 1);
  assert.deepEqual([...acknowledged], [1], "only the key actually included in the IQ is acknowledged");
  assert.deepEqual(partialRuntime.store.listUnpublishedPreKeyIds(), [2], "a pending key absent from the runtime bundle must remain pending");
  console.log("Messenger WA-binary prekey upload construction and IQ acknowledgement tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
