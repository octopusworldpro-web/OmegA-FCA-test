"use strict";

const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { createMediaShortcuts, createFcaClient } = require("../dist/index.js");

async function main() {
  const calls = [];
  const fakeStream = new PassThrough();
  const shortcuts = createMediaShortcuts({
    createReadStream: (filePath) => {
      assert.equal(filePath, "./photo.jpg");
      return fakeStream;
    },
    sendMessage: async (...args) => {
      calls.push(args);
      return { success: true };
    }
  });

  await shortcuts.sendImage("./photo.jpg", "thread-1", "caption");
  assert.equal(calls[0][0].body, "caption");
  assert.equal(calls[0][0].attachment, fakeStream);
  assert.equal(calls[0][1], "thread-1");

  const buffer = Buffer.from("media");
  await shortcuts.sendVideo(buffer, "thread-2");
  assert.equal(calls[1][0].attachment, buffer);

  const audioStream = new PassThrough();
  await shortcuts.sendAudio(audioStream, "thread-3", "voice");
  assert.equal(calls[2][0].attachment, audioStream);
  assert.equal(calls[2][0].body, "voice");

  await shortcuts.sendFile(buffer, "thread-4");
  assert.equal(calls[3][0].attachment, buffer);

  await shortcuts.sendLocation(23.8103, 90.4125, "thread-5");
  assert.deepEqual(calls[4][0].location, {
    latitude: 23.8103,
    longitude: 90.4125,
    current: false
  });

  assert.throws(() => shortcuts.sendLocation(91, 0, "thread"), /latitude/);
  assert.throws(() => shortcuts.sendLocation(0, 181, "thread"), /longitude/);
  assert.throws(() => shortcuts.sendLocation(0, 0, ""), /threadID/);
  assert.throws(() => shortcuts.sendImage("", "thread"), /file path/);

  const legacy = {
    listenMqtt() {},
    getHumanizer() { return { enabled: true }; },
    markAsDelivered() {},
    markAsRead() {},
    unsendMessage() {},
    getCurrentUserID() { return "123456789"; },
    getThreadList() {},
    setOptions() {},
    sendImage() {},
    sendVideo() {},
    sendAudio() {},
    sendFile() {},
    sendLocation() {}
  };
  const client = createFcaClient(legacy);
  assert.equal(client.realtime.listen, legacy.listenMqtt);
  assert.equal(client.account.getHumanizer, legacy.getHumanizer);
  assert.equal(client.account.getCurrentUserID, legacy.getCurrentUserID);
  assert.equal(client.account.setOptions, legacy.setOptions);
  assert.equal(client.messages.markDelivered, legacy.markAsDelivered);
  assert.equal(client.messages.markRead, legacy.markAsRead);
  assert.equal(client.messages.unsend, legacy.unsendMessage);
  assert.equal(client.messages.sendImage, legacy.sendImage);
  assert.equal(client.messages.sendVideo, legacy.sendVideo);
  assert.equal(client.messages.sendAudio, legacy.sendAudio);
  assert.equal(client.messages.sendFile, legacy.sendFile);
  assert.equal(client.messages.sendLocation, legacy.sendLocation);
  assert.equal(client.threads.getList, legacy.getThreadList);
  console.log("FCA media API parity tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
