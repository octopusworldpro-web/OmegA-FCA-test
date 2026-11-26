"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fca = require("../dist/index.js");

const alice = fca.generateOmegAX25519KeyPair();
const bob = fca.generateOmegAX25519KeyPair();
const ab = fca.deriveOmegAX25519(alice.privateKey, bob.publicKey);
const ba = fca.deriveOmegAX25519(bob.privateKey, alice.publicKey);
assert.deepEqual(ab, ba);
assert.equal(ab.length, 32);
assert.throws(() => fca.deriveOmegAX25519(Buffer.alloc(31), bob.publicKey), /32 bytes/);

const key = crypto.randomBytes(32);
const salt = crypto.randomBytes(32);
const k1 = fca.deriveOmegAHKDF(ab, salt, "OmegA-E2EE-test");
const k2 = fca.deriveOmegAHKDF(ab, salt, "OmegA-E2EE-test");
assert.deepEqual(k1, k2);
assert.notDeepEqual(k1, fca.deriveOmegAHKDF(ab, salt, "OmegA-E2EE-other"));

const aad = Buffer.from("account:123|peer:456");
const plaintext = Buffer.from("OmegA E2EE primitive round-trip");
const encrypted = fca.encryptOmegAAes256Gcm(key, plaintext, aad);
assert.deepEqual(fca.decryptOmegAAes256Gcm(key, encrypted, aad), plaintext);
assert.throws(() => fca.decryptOmegAAes256Gcm(key, encrypted, Buffer.from("wrong-aad")));
assert.throws(() => fca.decryptOmegAAes256Gcm(crypto.randomBytes(32), encrypted, aad));
assert.throws(() => fca.decryptOmegAAes256Gcm(key, { ...encrypted, tag: "AA==" }), /invalid base64|parameter lengths/);
console.log("OmegA native E2EE primitive tests passed");
