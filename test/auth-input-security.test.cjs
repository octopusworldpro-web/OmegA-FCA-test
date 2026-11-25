"use strict";

const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

const validate = fca.validateSessionCookieInput;
assert.equal(typeof validate, "function");

assert.doesNotThrow(() => validate("c_user=123456789; xs=session-token"));
assert.doesNotThrow(() => validate([
  { key: "c_user", value: "123456789" },
  { key: "xs", value: "session-token" }
]));
assert.throws(() => validate("xs=session-token"), /missing or invalid c_user/);
assert.throws(() => validate("c_user=123456789"), /missing or empty xs/);
assert.throws(() => validate("c_user=0; xs=session-token"), /missing or invalid c_user/);
assert.throws(() => validate([
  { key: "c_user", value: "123456789", expirationDate: Math.floor(Date.now() / 1000) - 60 },
  { key: "xs", value: "session-token" }
]), /c_user cookie has expired/);
assert.throws(() => validate([]), /no usable cookies/);

console.log("Authentication input security tests passed.");
