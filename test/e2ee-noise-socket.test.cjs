"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");
assert.equal(typeof fca.connectMessengerNoiseSocket, "function");
assert.equal(typeof fca.MessengerNoiseSocket, "function");
assert.equal(typeof fca.decodeMessengerBinaryNode, "function");

const nested = fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 2, 25, 248, 1, 76]));
assert.deepEqual(nested, { tag: "iq", attrs: {}, content: [{ tag: "success", attrs: {} }] });
const deeplyNested = fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 2, 25, 248, 1, 248, 2, 25, 248, 1, 76]));
assert.deepEqual(deeplyNested.content[0].content, [{ tag: "success", attrs: {} }]);
const success = fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 1, 76]));
assert.equal(success.tag, "success");
const iq = fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 5, 25, 8, 252, 3, 112, 107, 49, 4, 20]));
assert.deepEqual(iq, { tag: "iq", attrs: { id: "pk1", type: "result" } });
const rejected = fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 5, 25, 8, 252, 3, 112, 107, 49, 4, 168]));
assert.equal(rejected.attrs.type, "error");
assert.throws(() => fca.decodeMessengerBinaryNode(Buffer.from([0, 248, 5, 25, 8, 252, 9])), /Truncated/);
console.log("Messenger Noise socket and IQ binary-node fixture tests passed");
