"use strict";

const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

const { extractExpectedSessionUserId, assertSessionIdentity } = fca;

assert.equal(extractExpectedSessionUserId([
  { key: "c_user", value: "123456789" },
  { key: "xs", value: "session-token" }
]), "123456789");
assert.equal(extractExpectedSessionUserId(undefined, "Cookie: c_user=987654321; xs=a=b"), "987654321");
assert.equal(extractExpectedSessionUserId(undefined, [{ name: "c_user", value: "24680" }]), "24680");
assert.equal(extractExpectedSessionUserId([{ key: "xs", value: "no-identity" }]), null);
assert.doesNotThrow(() => assertSessionIdentity("123456789", "123456789"));
assert.throws(() => assertSessionIdentity("123456789", "987654321"), /Session identity mismatch/);
assert.throws(() => assertSessionIdentity("123456789", ""), /did not confirm a valid account UID/);
assert.throws(() => extractExpectedSessionUserId([{ key: "c_user", value: "not-a-number" }]), /c_user must be a positive numeric/);

console.log("Session identity validation tests passed.");
