"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const sessions = new Set();
  const established = [];
  const encrypted = [];
  const fetched = [];
  const devices = [{ name: "peer-1", deviceId: 2 }, { name: "peer-1", deviceId: 1 }];
  const manager = fca.createSignalPeerManager({
    store: { loadSession: (address) => sessions.has(`${address.name}.${address.deviceId}`) ? "stored" : undefined },
    listDevices: async (name) => {
      assert.equal(name, "peer-1");
      return devices;
    },
    fetchPreKeyBundle: async (device) => { fetched.push(device.deviceId); return { remoteDeviceId: device.deviceId }; },
    parsePreKeyBundle: (payload, device) => ({ deviceId: payload.remoteDeviceId, parsedFor: device.deviceId }),
    directMessages: {
      establishSession: async (device, bundle) => {
        assert.equal(bundle.deviceId, device.deviceId);
        assert.equal(bundle.parsedFor, device.deviceId);
        established.push(device.deviceId);
        sessions.add(`${device.name}.${device.deviceId}`);
      },
      encrypt: async (device, plaintext) => {
        encrypted.push(device.deviceId);
        return { type: 1, body: Buffer.from(`${device.deviceId}:${plaintext}`).toString("base64") };
      },
      decrypt: async (device, ciphertext) => Buffer.from(`${device.name}.${device.deviceId}:${ciphertext.body}`)
    }
  });

  await Promise.all([manager.preparePeer("peer-1"), manager.preparePeer("peer-1")]);
  assert.deepEqual(fetched, [1, 2], "concurrent preparation must fetch each device bundle once");
  const outgoing = await manager.encryptForPeer("peer-1", "hello");
  assert.deepEqual(established, [1, 2]);
  assert.deepEqual(outgoing.map((item) => item.recipient.deviceId), [1, 2]);
  assert.deepEqual(encrypted, [1, 2]);
  await manager.encryptForPeer("peer-1", "again");
  assert.deepEqual(established, [1, 2], "existing per-device sessions must be reused");

  const plaintext = await manager.decryptFromDevice({ name: "peer-1", deviceId: 2 }, { type: 1, body: "cipher" });
  assert.equal(plaintext.toString(), "peer-1.2:cipher");
  await assert.rejects(manager.resolveDevices(""), /peerName/);

  const duplicateManager = fca.createSignalPeerManager({
    store: { loadSession: () => undefined },
    listDevices: async () => [{ name: "peer-1", deviceId: 1 }, { name: "peer-1", deviceId: 1 }],
    fetchPreKeyBundle: async () => ({}),
    parsePreKeyBundle: (payload) => payload,
    directMessages: { establishSession: async () => {}, encrypt: async () => ({}), decrypt: async () => new Uint8Array() }
  });
  await assert.rejects(duplicateManager.resolveDevices("peer-1"), /duplicate Signal device ID/);
  console.log("Signal multi-device peer manager tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
