"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  for (const kind of ["image", "video", "audio", "document"]) {
    const data = Buffer.alloc(kind === "video" ? 256 * 1024 : 8193);
    for (let i = 0; i < data.length; i++) data[i] = (i * 19) & 255;
    const encrypted = fca.encryptMessengerMedia(data, kind);
    assert.equal(encrypted.fields.mediaKey.length, 32);
    assert.equal(encrypted.fields.fileSHA256.length, 32);
    assert.equal(encrypted.fields.fileEncSHA256.length, 32);
    assert.notDeepEqual(encrypted.uploadBytes, data);
    assert.deepEqual(fca.decryptMessengerMedia(encrypted.uploadBytes, encrypted.fields), data);

    const fields = {
      ...encrypted.fields, directPath: "/media/test-path",
      mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/ogg" : "application/pdf",
      fileName: "fixture.bin", width: kind === "image" || kind === "video" ? 640 : undefined,
      height: kind === "image" || kind === "video" ? 360 : undefined, seconds: kind === "audio" || kind === "video" ? 4 : undefined
    };
    const app = fca.buildMessengerMediaApplication(fields);
    assert.ok(Buffer.isBuffer(app.messageApp) && app.messageApp.length > 0);
    assert.equal(app.frankingTag.length, 32);
    assert.notDeepEqual(app.frankingTag, Buffer.alloc(32));
    const tampered = Buffer.from(encrypted.uploadBytes);
    tampered[0] ^= 1;
    assert.throws(() => fca.decryptMessengerMedia(tampered, encrypted.fields), /SHA-256 mismatch|HMAC mismatch/);
    const tamperedMac = Buffer.from(encrypted.uploadBytes);
    tamperedMac[tamperedMac.length - 1] ^= 1;
    const crypto = require("node:crypto");
    const forgedDigestOnly = { ...encrypted.fields, fileEncSHA256: crypto.createHash("sha256").update(tamperedMac).digest() };
    assert.throws(() => fca.decryptMessengerMedia(tamperedMac, forgedDigestOnly), /HMAC mismatch/);
  }

  const empty = fca.encryptMessengerMedia(Buffer.alloc(0), "document");
  assert.equal(empty.fields.fileLength, 0);
  assert.deepEqual(fca.decryptMessengerMedia(empty.uploadBytes, empty.fields), Buffer.alloc(0));

  const originalFetch = global.fetch;
  let requestedUrl = "";
  let uploadedBytes;
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    uploadedBytes = Buffer.from(options.body);
    return { ok: true, json: async () => ({ direct_path: "/v/t59.2708-21/fixture", object_id: "media-object-1", handle: "opaque-handle" }) };
  };
  try {
    const encrypted = fca.encryptMessengerMedia(Buffer.from("upload fixture"), "image");
    const result = await fca.uploadMessengerMedia({ host: "rupload.facebook.com", auth: "test-auth", fetchedAtMs: Date.now() }, encrypted, "image");
    assert.match(requestedUrl, /^https:\/\/rupload\.facebook\.com\/wa-msgr\/mms\/image\//);
    assert.match(requestedUrl, /auth=test-auth/);
    assert.deepEqual(uploadedBytes, encrypted.uploadBytes);
    assert.equal(result.directPath, "/v/t59.2708-21/fixture");
    assert.equal(result.objectId, "media-object-1");

    let attempts = 0, refreshes = 0;
    global.fetch = async (url) => {
      attempts++;
      requestedUrl = String(url);
      if (attempts === 1) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ direct_path: "/v/t59.2708-21/refreshed" }) };
    };
    const refreshed = await fca.uploadMessengerMedia(
      { host: "old-upload.facebook.com", auth: "expired", fetchedAtMs: Date.now() },
      encrypted, "image",
      async () => { refreshes++; return { host: "rupload.facebook.com", auth: "fresh", fetchedAtMs: Date.now() }; }
    );
    assert.equal(attempts, 2);
    assert.equal(refreshes, 1);
    assert.match(requestedUrl, /auth=fresh/);
    assert.equal(refreshed.directPath, "/v/t59.2708-21/refreshed");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("Native Messenger E2EE media crypto, protobuf, and upload fixtures passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
