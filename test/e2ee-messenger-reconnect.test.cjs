"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

class FakeSocket {
  constructor() { this.frames = []; this.nodes = new Set(); this.closes = new Set(); this.closed = false; }
  async sendFrame(frame) { if (this.closed) throw new Error("closed"); this.frames.push(Buffer.from(frame)); }
  async sendIQ(_frame, id) { return { tag: "iq", attrs: { id, type: "result" } }; }
  onNode(fn) { this.nodes.add(fn); return () => this.nodes.delete(fn); }
  onClose(fn) { this.closes.add(fn); return () => this.closes.delete(fn); }
  close() { this.closed = true; for (const fn of [...this.closes]) fn(new Error("closed")); }
  emit(node) { for (const fn of [...this.nodes]) fn(node); }
}
const store = {
  loadSession: () => true,
  removeSenderKey: async () => {},
  getSenderKeyDistributionRecipients: () => [],
  markSenderKeyDistributionDelivered: async () => {},
  clearSenderKeyDistribution: async () => {}
};
const runtime = {
  store,
  directMessages: {
    establishSession: async () => {},
    encrypt: async () => ({ type: 2, body: Buffer.from("x").toString("base64") }),
    decrypt: async () => Buffer.alloc(0)
  },
  groups: {
    createDistribution: async () => ({ groupId: "g", sender: { name: "123", deviceId: 1 }, body: Buffer.from("s").toString("base64") }),
    processDistribution: async () => {},
    encrypt: async () => ({ groupId: "g", sender: { name: "123", deviceId: 1 }, body: "x" }),
    decrypt: async () => Buffer.alloc(0)
  }
};
(async () => {
  const first = new FakeSocket();
  const second = new FakeSocket();
  let reconnectCalls = 0;
  const service = new fca.MessengerE2EEService({
    accountId: "123456789",
    localDeviceId: 42,
    runtime,
    socket: first,
    signal: {},
    reconnect: async () => { reconnectCalls++; return second; }
  });
  await service.ready;
  const payload = Buffer.from([0, 1, 2, 255]);
  const pending = service.sendStanzaWithAck(payload, "retry-fixture", 10000);
  assert.equal(first.frames.some((frame) => frame.equals(payload)), true);
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(reconnectCalls, 1);
  assert.equal(second.frames.some((frame) => frame.equals(payload)), true, "same encrypted stanza is replayed after reconnect");
  second.emit({ tag: "ack", attrs: { id: "retry-fixture" } });
  await pending;
  service.close();
  console.log("Messenger E2EE reconnect and encrypted outbox replay fixtures passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
