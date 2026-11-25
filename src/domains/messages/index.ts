import {
  createSendMessageCommand,
  type SendMessageCommandDeps
} from "./commands/send-message";
import {
  createMarkReadCommand,
  type MarkReadCommandDeps
} from "./commands/mark-read";
import {
  createSendTypingIndicatorCommand,
  type SendTypingIndicatorCommandDeps
} from "./commands/send-typing-indicator";
import {
  createMarkSeenCommand,
  type MarkSeenCommandDeps
} from "./commands/mark-seen";
import {
  createMarkDeliveredCommand,
  type MarkDeliveredCommandDeps
} from "./commands/mark-delivered";
import {
  createMarkReadAllCommand,
  type MarkReadAllCommandDeps
} from "./commands/mark-read-all";
import {
  createSetMessageReactionCommand,
  type SetMessageReactionCommandDeps
} from "./commands/set-message-reaction";
import {
  createShareContactCommand,
  type ShareContactCommandDeps
} from "./commands/share-contact";
import {
  createEditMessageCommand,
  type EditMessageCommandDeps
} from "./commands/edit-message";
import {
  createDeleteMessageCommand,
  type DeleteMessageCommandDeps
} from "./commands/delete-message";
import {
  createUnsendMessageCommand,
  type UnsendMessageCommandDeps
} from "./commands/unsend-message";
import {
  createForwardAttachmentCommand,
  type ForwardAttachmentCommandDeps
} from "./commands/forward-attachment";
import {
  createUploadAttachmentCommand,
  type UploadAttachmentCommandDeps
} from "./commands/upload-attachment";
import {
  createChangeThreadColorCommand,
  type ChangeThreadColorCommandDeps
} from "./commands/change-thread-color";
import {
  createChangeThreadEmojiCommand,
  type ChangeThreadEmojiCommandDeps
} from "./commands/change-thread-emoji";
import { createGetEmojiUrlQuery } from "./queries/get-emoji-url";
import { createGetThreadColorsQuery } from "./queries/get-thread-colors";
import {
  createResolvePhotoUrlQuery,
  type ResolvePhotoUrlQueryDeps
} from "./queries/resolve-photo-url";
import {
  createGetMessageQuery,
  type GetMessageQueryDeps
} from "./queries/get-message";
import { createOutgoingActionLimiter } from "../realtime/outgoing-action-limiter";

export interface MessagesDomainDeps {
  send: SendMessageCommandDeps;
  markRead: MarkReadCommandDeps;
  typing: SendTypingIndicatorCommandDeps;
  markSeen?: MarkSeenCommandDeps;
  markDelivered?: MarkDeliveredCommandDeps;
  markReadAll?: MarkReadAllCommandDeps;
  reaction: SetMessageReactionCommandDeps;
  uploadAttachment?: UploadAttachmentCommandDeps;
  edit?: EditMessageCommandDeps;
  delete?: DeleteMessageCommandDeps;
  unsend?: UnsendMessageCommandDeps;
  forwardAttachment?: ForwardAttachmentCommandDeps;
  shareContact?: ShareContactCommandDeps;
  threadColor: ChangeThreadColorCommandDeps;
  threadEmoji: ChangeThreadEmojiCommandDeps;
  get?: GetMessageQueryDeps;
  photoUrl?: ResolvePhotoUrlQueryDeps;
}

function compactNamespace(namespace: Record<string, Loose>) {
  return Object.fromEntries(
    Object.entries(namespace).filter(([, value]) => value !== undefined)
  );
}

export function createMessagesDomain(deps: MessagesDomainDeps) {
  const limiter = createOutgoingActionLimiter();
  const send = createSendMessageCommand(deps.send);
  const markRead = createMarkReadCommand(deps.markRead);
  const typing = createSendTypingIndicatorCommand(deps.typing);
  const markSeen = deps.markSeen ? createMarkSeenCommand(deps.markSeen) : undefined;
  const markDelivered = deps.markDelivered ? createMarkDeliveredCommand(deps.markDelivered) : undefined;
  const markReadAll = deps.markReadAll ? createMarkReadAllCommand(deps.markReadAll) : undefined;
  const reaction = createSetMessageReactionCommand(deps.reaction);
  const edit = deps.edit ? createEditMessageCommand(deps.edit) : undefined;
  const deleteMessage = deps.delete ? createDeleteMessageCommand(deps.delete) : undefined;
  const unsend = deps.unsend ? createUnsendMessageCommand(deps.unsend) : undefined;
  const forwardAttachment = deps.forwardAttachment
    ? createForwardAttachmentCommand(deps.forwardAttachment)
    : undefined;
  const shareContact = deps.shareContact ? createShareContactCommand(deps.shareContact) : undefined;
  const setThreadColor = createChangeThreadColorCommand(deps.threadColor);
  const setThreadEmoji = createChangeThreadEmojiCommand(deps.threadEmoji);

  return compactNamespace({
    send: limiter.wrap(send, (_message, threadID) => threadID),
    markRead: limiter.wrap(markRead, (threadID) => threadID),
    typing: limiter.wrap(typing, (threadID) => threadID),
    markSeen: markSeen ? limiter.wrap(markSeen, () => "__seen__") : undefined,
    markDelivered: markDelivered ? limiter.wrap(markDelivered, (threadID) => threadID) : undefined,
    markReadAll: markReadAll ? limiter.wrap(markReadAll, () => "__read_all__") : undefined,
    react: limiter.wrap(reaction, (_reaction, _messageID, threadID) => threadID),
    uploadAttachment: deps.uploadAttachment
      ? createUploadAttachmentCommand(deps.uploadAttachment)
      : undefined,
    edit: edit ? limiter.wrap(edit, (_text, messageID) => messageID) : undefined,
    delete: deleteMessage
      ? limiter.wrap(deleteMessage, (messageIDs) => Array.isArray(messageIDs) ? messageIDs.join(",") : messageIDs)
      : undefined,
    unsend: unsend ? limiter.wrap(unsend, (_messageID, threadID) => threadID) : undefined,
    forwardAttachment: forwardAttachment
      ? limiter.wrap(forwardAttachment, (threadID) => threadID)
      : undefined,
    shareContact: shareContact ? limiter.wrap(shareContact, (_text, _senderID, threadID) => threadID) : undefined,
    setThreadColor: limiter.wrap(setThreadColor, (_color, threadID) => threadID),
    setThreadEmoji: limiter.wrap(setThreadEmoji, (_emoji, threadID) => threadID),
    get: deps.get ? createGetMessageQuery(deps.get) : undefined,
    getEmojiUrl: createGetEmojiUrlQuery(),
    getThreadColors: createGetThreadColorsQuery(),
    resolvePhotoUrl: deps.photoUrl ? createResolvePhotoUrlQuery(deps.photoUrl) : undefined
  });
}

export * from "./message.types";
export * from "./commands/send-message";
export * from "./commands/mark-read";
export * from "./commands/send-typing-indicator";
export * from "./commands/mark-seen";
export * from "./commands/mark-delivered";
export * from "./commands/mark-read-all";
export * from "./commands/set-message-reaction";
export * from "./commands/upload-attachment";
export * from "./commands/edit-message";
export * from "./commands/delete-message";
export * from "./commands/unsend-message";
export * from "./commands/forward-attachment";
export * from "./commands/share-contact";
export * from "./commands/change-thread-color";
export * from "./commands/change-thread-emoji";
export * from "./queries/get-message";
export * from "./queries/get-emoji-url";
export * from "./queries/get-thread-colors";
export * from "./queries/resolve-photo-url";

export { createMediaShortcuts, type MediaShortcutDeps } from "./media-shortcuts";
