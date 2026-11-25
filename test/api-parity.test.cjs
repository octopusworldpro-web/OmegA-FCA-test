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

  // Mirror the flat FCA methods consumed by GoatBot and verify every
  // documented namespace alias remains available through createFcaClient().
  const methodNames = [
    "listenMqtt", "stopListening", "stopListeningAsync",
    "getHumanizer", "markAsDelivered", "markAsRead", "markAsReadAll",
    "markAsSeen", "unsendMessage", "deleteMessage", "editMessage",
    "getCurrentUserID", "getAppState", "getCookies", "setOptions",
    "sendMessage", "sendImage", "sendVideo", "sendAudio", "sendFile",
    "sendLocation", "sendTypingIndicator", "setMessageReaction",
    "shareContact", "shareLink", "uploadAttachment", "forwardAttachment", "setReaction",
    "getThreadList", "getThreadInfo", "getThreadHistory", "getThreadPictures",
    "createNewGroup", "addUserToGroup", "removeUserFromGroup",
    "changeAdminStatus", "changeGroupImage", "changeThreadColor",
    "changeThreadEmoji", "changeNickname", "setTitle", "muteThread",
    "changeArchivedStatus", "deleteThread", "createPoll", "createThemeAI",
    "getThemePictures", "handleMessageRequest", "searchForThread",
    "getUserID", "getUserInfo", "getUserInfoV2", "getFriendsList",
    "addExternalModule", "changeAvatar", "changeBio", "logout",
    "refreshFb_dtsg", "setPostReaction", "reactToPost", "reactToComment",
    "postComment", "sharePost", "unfriend", "changeBlockedStatus",
    "httpGet", "httpPost", "postFormData"
  ];
  const legacy = Object.fromEntries(methodNames.map((name) => [name, function () {
    return name;
  }]));
  legacy.threadColors = [];
  legacy.scheduler = { schedule() {} };

  const client = createFcaClient(legacy);
  const namespaceMethods = {
    realtime: ["listen", "stop", "stopAsync"],
    messages: [
      "send", "sendImage", "sendVideo", "sendAudio", "sendFile",
      "sendLocation", "edit", "delete", "unsend", "markRead",
      "markReadAll", "markSeen", "markDelivered", "typing", "react", "setReaction",
      "shareContact", "shareLink", "uploadAttachment", "forwardAttachment"
    ],
    threads: [
      "getInfo", "getList", "getHistory", "getPictures", "createGroup",
      "addUsers", "removeUser", "setAdmin", "setImage", "setColor",
      "setEmoji", "setNickname", "setTitle", "mute", "archive",
      "delete", "createPoll", "createThemeAI", "getThemePictures",
      "handleMessageRequest", "search"
    ],
    users: ["getID", "getInfo", "getInfoV2", "getFriends"],
    account: [
      "getCurrentUserID", "getAppState", "getCookies", "setOptions",
      "getHumanizer", "logout", "changeAvatar", "changeBio"
    ],
    http: ["get", "post", "postFormData"]
  };

  for (const [namespace, names] of Object.entries(namespaceMethods)) {
    for (const name of names) {
      assert.equal(
        typeof client[namespace][name],
        "function",
        `Missing ${namespace}.${name} FCA compatibility alias`
      );
    }
  }
  assert.equal(client.raw, legacy);
  assert.equal(client.account.getCurrentUserID(), "getCurrentUserID");
  assert.equal(client.messages.send(), "sendMessage");
  assert.equal(client.messages.setReaction(), "setMessageReaction");
  assert.equal(client.messages.react(), "setMessageReaction");
  assert.equal(client.threads.getList(), "getThreadList");
  assert.equal(client.users.getInfo(), "getUserInfo");
  assert.equal(client.http.get(), "httpGet");
  assert.deepEqual(client.threads.colors, []);

  console.log("FCA media and legacy API parity tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
