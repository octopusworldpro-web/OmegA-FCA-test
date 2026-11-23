import fs from "node:fs";
import type { Readable } from "node:stream";
import type { NodeStyleCallback } from "../../compat/callbackify";

type SendMessage = (
  message: { body: string; attachment?: Buffer | NodeJS.ReadableStream; location?: { latitude: number; longitude: number; current?: boolean } },
  threadID: string,
  callback?: NodeStyleCallback<Loose>
) => Promise<Loose>;

export interface MediaShortcutDeps {
  sendMessage: SendMessage;
  createReadStream?: (filePath: string) => Readable;
}

function resolveAttachment(
  input: string | Buffer | NodeJS.ReadableStream,
  createReadStream: (filePath: string) => Readable
): Buffer | NodeJS.ReadableStream {
  if (typeof input === "string") {
    if (!input.trim()) throw new Error("Media file path is required");
    return createReadStream(input);
  }
  if (Buffer.isBuffer(input)) return input;
  if (input && typeof (input as NodeJS.ReadableStream).pipe === "function") return input;
  throw new Error("Media must be a file path, Buffer, or readable stream");
}

function normalizeCaption(
  captionOrCallback?: string | NodeStyleCallback<Loose>,
  callback?: NodeStyleCallback<Loose>
) {
  return {
    caption: typeof captionOrCallback === "string" ? captionOrCallback : "",
    callback: typeof captionOrCallback === "function" ? captionOrCallback : callback
  };
}

/** File-path, Buffer, and stream shortcuts matching the classic FCA media helpers. */
export function createMediaShortcuts(deps: MediaShortcutDeps) {
  const createReadStream = deps.createReadStream || ((filePath: string) => fs.createReadStream(filePath));

  function sendMedia(
    input: string | Buffer | NodeJS.ReadableStream,
    threadID: string,
    captionOrCallback?: string | NodeStyleCallback<Loose>,
    callback?: NodeStyleCallback<Loose>
  ) {
    const normalized = normalizeCaption(captionOrCallback, callback);
    const attachment = resolveAttachment(input, createReadStream);
    return deps.sendMessage({ body: normalized.caption, attachment }, String(threadID), normalized.callback);
  }

  function sendLocation(
    latitude: number,
    longitude: number,
    threadID: string,
    callback?: NodeStyleCallback<Loose>
  ) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error("latitude must be between -90 and 90");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("longitude must be between -180 and 180");
    }
    if (!String(threadID || "").trim()) throw new Error("threadID is required");
    return deps.sendMessage({
      body: "",
      location: { latitude, longitude, current: false }
    }, String(threadID), callback);
  }

  return {
    sendImage: sendMedia,
    sendVideo: sendMedia,
    sendAudio: sendMedia,
    sendFile: (input: string | Buffer | NodeJS.ReadableStream, threadID: string, callback?: NodeStyleCallback<Loose>) =>
      sendMedia(input, threadID, callback),
    sendLocation
  };
}
