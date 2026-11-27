"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");
assert.equal(typeof fca.connectMessengerNoiseSocket, "function");
assert.equal(typeof fca.MessengerNoiseSocket, "function");
console.log("Messenger Noise socket API export tests passed");
