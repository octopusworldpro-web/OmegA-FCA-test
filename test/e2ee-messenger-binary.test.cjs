"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");
assert.equal(typeof fca.encodeMessengerNode, "function");
assert.equal(typeof fca.marshalMessengerNode, "function");
assert.equal(typeof fca.decodeMessengerNode, "function");

const ciphertext = Buffer.from([0, 1, 2, 127, 128, 255]);
const node = fca.encodeMessengerNode("message", {
  id: "fixture-1",
  to: "123456789.17@msgr",
  type: "text"
}, [
  fca.encodeMessengerNode("enc", { v: "3", type: "msg" }, ciphertext),
  fca.encodeMessengerNode("participants", {}, [
    fca.encodeMessengerNode("to", { jid: "987654321.8@msgr" }, [
      fca.encodeMessengerNode("enc", { v: "3", type: "pkmsg" }, Buffer.from([9, 8, 7]))
    ])
  ])
]);
const decoded = fca.decodeMessengerNode(fca.marshalMessengerNode(node));
assert.equal(decoded.tag, "message");
assert.equal(decoded.attrs.to, "123456789.17@msgr");
assert.equal(decoded.attrs.id, "fixture-1");
assert.deepEqual(decoded.content[0].content, ciphertext);
assert.equal(decoded.content[1].content[0].attrs.jid, "987654321.8@msgr");
assert.deepEqual(decoded.content[1].content[0].content[0].content, Buffer.from([9, 8, 7]));

const malformed = Buffer.from([0, 248, 5, 25, 8, 252, 9]);
assert.throws(() => fca.decodeMessengerNode(malformed));
console.log("Messenger WA-binary codec fixtures passed");
