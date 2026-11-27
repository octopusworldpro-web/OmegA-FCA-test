"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

assert.equal(typeof fca.verifyMessengerNoiseCertificateChain, "function");
assert.throws(() => fca.verifyMessengerNoiseCertificateChain(Buffer.alloc(0), Buffer.alloc(32)), /certificate chain is required/);
assert.throws(() => fca.verifyMessengerNoiseCertificateChain(Buffer.from([0x0a, 0x00, 0x12, 0x00]), Buffer.alloc(32)), /missing or duplicates/);
assert.throws(() => fca.verifyMessengerNoiseCertificateChain(Buffer.from([0x80]), Buffer.alloc(32)), /varint/);
assert.throws(() => fca.verifyMessengerNoiseCertificateChain(Buffer.from([0x0a, 0x00, 0x12, 0x00]), Buffer.alloc(31)), /exactly 32 bytes/);
console.log("Messenger Noise certificate validation negative tests passed");
