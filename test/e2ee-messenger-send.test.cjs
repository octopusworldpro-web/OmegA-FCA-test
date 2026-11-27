"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

class ProtoWriter {
  constructor() { this.parts = []; }
  var(field, value) { this.parts.push(this.v(field * 8), this.v(value)); return this; }
  bytes(field, value) { const b = Buffer.from(value); this.parts.push(this.v(field * 8 + 2), this.v(b.length), b); return this; }
  string(field, value) { return this.bytes(field, Buffer.from(value)); }
  v(value) { let n = BigInt(value), out = []; while (n > 127n) { out.push(Number((n & 127n) | 128n)); n >>= 7n; } out.push(Number(n)); return Buffer.from(out); }
  build() { return Buffer.concat(this.parts); }
}
function textTransport(text) {
  const messageText = new ProtoWriter().string(1, text).build();
  const content = new ProtoWriter().bytes(1, messageText).build();
  const payload = new ProtoWriter().bytes(1, content).build();
  const consumer = new ProtoWriter().bytes(1, payload).build();
  const consumerSub = new ProtoWriter().bytes(1, consumer).var(2, 1).build();
  const subProtocol = new ProtoWriter().var(1, 0).bytes(2, consumerSub).build();
  const appPayload = new ProtoWriter().bytes(4, subProtocol).build();
  const messageApp = new ProtoWriter().bytes(1, appPayload).build();
  const application = new ProtoWriter().bytes(1, messageApp).var(2, 2).build();
  const app = new ProtoWriter().bytes(1, application).var(3, 0).build();
  const integral = new ProtoWriter().bytes(1, Buffer.from([1, 2, 3])).build();
  const protocol = new ProtoWriter().bytes(1, integral).build();
  return new ProtoWriter().bytes(1, app).bytes(2, protocol).build();
}
const incomingTransport = textTransport("decrypted inbound");
class FakeSocket {
  constructor() { this.nodes = new Set(); this.closes = new Set(); this.frames = []; this.remoteDeviceId = 17; }
  onNode(fn) { this.nodes.add(fn); return () => this.nodes.delete(fn); }
  onClose(fn) { this.closes.add(fn); return () => this.closes.delete(fn); }
  async sendFrame(frame) {
    const bytes = Buffer.from(frame);
    this.frames.push(bytes);
    const node = fca.decodeMessengerNode(bytes);
    if (node.tag === "message" && node.attrs.id) {
      queueMicrotask(() => { for (const fn of [...this.nodes]) fn({ tag: "ack", attrs: { id: node.attrs.id } }); });
    }
  }
  async sendIQ(frame, id) {
    const node = fca.decodeMessengerNode(frame);
    if (node.attrs.xmlns === "fbid:devices") {
      const jid = node.content[0].content[0].attrs.jid;
      const user = jid.split("@")[0].split(".")[0];
      return { tag: "iq", attrs: { id, type: "result" }, content: [{
        tag: "users", attrs: {}, content: [{
          tag: "user", attrs: { jid: `${user}.0@msgr` }, content: [{
            tag: "devices", attrs: {}, content: [{ tag: "device", attrs: { id: user === "123456789" ? "43" : String(this.remoteDeviceId) } }]
          }]
        }]
      }] };
    }
    if (node.attrs.xmlns === "w:g2") {
      return { tag: "iq", attrs: { id, type: "result" }, content: [{
        tag: "group", attrs: {}, content: [{ tag: "participant", attrs: { jid: "987654321.0@msgr" } }]
      }] };
    }
    throw new Error("unexpected IQ namespace " + node.attrs.xmlns);
  }
  emit(node) { for (const fn of [...this.nodes]) fn(node); }
  close() { for (const fn of [...this.closes]) fn(new Error("closed")); }
}
const socket = new FakeSocket();
const delivered = ["987654321.17", "123456789.43"];
const groupMemberships = new Map();
const runtime = {
  registrationId: 7,
  identityKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 1)]).toString("base64"),
  signedPreKey: { keyId: 2, publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 2)]).toString("base64"), signature: Buffer.alloc(64, 3).toString("base64") },
  preKeys: [],
  store: {
    loadSession: () => true,
    listUnpublishedPreKeyIds: () => [],
    getSenderKeyDistributionRecipients: () => delivered,
    markSenderKeyDistributionDelivered: async () => {},
    clearSenderKeyDistribution: async () => {},
    removeSenderKey: async () => {},
    getGroupMembershipSnapshot: (groupId) => groupMemberships.get(groupId),
    setGroupMembershipSnapshot: async (groupId, members) => groupMemberships.set(groupId, [...members]),
    listGroupMembershipSnapshots: () => [...groupMemberships].map(([groupId, members]) => ({ groupId, members }))
  },
  directMessages: {
    establishSession: async () => {},
    encrypt: async () => ({ type: 2, body: Buffer.from("ciphertext").toString("base64") }),
    decrypt: async () => incomingTransport
  },
  groups: {
    createDistribution: async () => ({ groupId: "123-456@g.us", sender: { name: "123456789", deviceId: 42 }, body: Buffer.from("skdm").toString("base64") }),
    processDistribution: async () => {},
    encrypt: async (groupId, sender) => ({ groupId, sender, body: Buffer.from("group-cipher").toString("base64") }),
    decrypt: async () => incomingTransport
  }
};
(async () => {
  const service = new fca.MessengerE2EEService({
    accountId: "123456789", localDeviceId: 42, runtime, socket,
    signal: { CiphertextMessageType: { PreKey: 3, Whisper: 2 } }
  });
  await service.ready;
  const directId = await service.sendDirectText("987654321", "hello direct");
  assert.ok(directId);
  const direct = socket.frames.map((frame) => fca.decodeMessengerNode(frame)).find((node) => node.tag === "message" && node.attrs.id === directId);
  assert.equal(direct.content[0].tag, "participants");
  assert.equal(direct.content[0].content.length, 2);
  assert.equal(direct.content[0].content[0].content[0].attrs.type, "msg");

  let membershipChanges = 0;
  service.on("group_membership_changed", () => membershipChanges++);
  const groupId = await service.sendGroupText("123-456@g.us", "hello group");
  assert.ok(groupId);
  assert.deepEqual(groupMemberships.get("123-456@g.us"), ["123456789.43", "987654321.17"]);
  const group = socket.frames.map((frame) => fca.decodeMessengerNode(frame)).find((node) => node.tag === "message" && node.attrs.id === groupId);
  assert.equal(group.attrs.to, "123-456@g.us");
  assert.equal(group.content.find((child) => child.tag === "enc").attrs.type, "skmsg");
  assert.match(group.attrs.phash, /^2:/);
  socket.remoteDeviceId = 18;
  await service.sendGroupText("123-456@g.us", "after member device change");
  assert.equal(membershipChanges, 1, "device-directory changes automatically rotate the group Sender Key");
  assert.deepEqual(groupMemberships.get("123-456@g.us"), ["123456789.43", "987654321.18"]);

  const received = [];
  service.on("message", (message) => received.push(message));
  socket.emit({
    tag: "message",
    attrs: { from: "987654321.17@msgr", id: "incoming-direct", t: "1700000000" },
    content: [{
      tag: "participants", attrs: {}, content: [{
        tag: "to", attrs: { jid: "123456789.42@msgr" }, content: [{
          tag: "enc", attrs: { type: "msg" }, content: Buffer.from("direct-cipher")
        }]
      }]
    }]
  });
  socket.emit({
    tag: "message",
    attrs: { from: "123-456@g.us", participant: "987654321.17@msgr", id: "incoming-group", t: "1700000001" },
    content: [{ tag: "enc", attrs: { type: "skmsg" }, content: Buffer.from("group-cipher") }]
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 2);
  assert.equal(received[0].threadId, "987654321.17@msgr");
  assert.equal(received[0].text, "decrypted inbound");
  assert.equal(received[1].threadId, "123-456@g.us");
  assert.equal(received[1].senderId, "987654321");
  service.close();
  console.log("Messenger direct/group send and receive fixtures passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
