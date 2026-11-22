import { randomUUID } from "node:crypto";
import { createLegacyPromise } from "../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../compat/callbackify";
import type { FcaContext } from "../../core/state";
import { postGraphql } from "../../transport/http/graphql";

type CallbackResult = (error?: Loose, result?: Loose) => void;

export interface SocialDomainDeps {
  defaultFuncs: { post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose> };
  ctx: FcaContext;
  sendMessage: (message: Loose, threadID: string, callback?: NodeStyleCallback<Loose>) => Promise<Loose>;
  logError?: (scope: string, error: Loose) => void;
}

const REACTIONS: Record<string, number> = {
  unlike: 0, none: 0, unreact: 0, undo: 0,
  like: 1, care: 2, heart: 2, wow: 3, haha: 4, sad: 7, angry: 8, love: 16
};

function normalizeId(value: string | number, label: string): string {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(label + " is required");
  const parts = id.split("_");
  return parts[parts.length - 1];
}

function callbackPromise<T>(callback?: CallbackResult) {
  return createLegacyPromise<T>(callback as NodeStyleCallback<T> | undefined);
}

function runMutation(
  deps: SocialDomainDeps,
  scope: string,
  friendlyName: string,
  docId: string,
  variables: Record<string, Loose>,
  callback?: CallbackResult
) {
  const { callback: cb, promise } = callbackPromise<Loose>(callback);
  postGraphql({
    defaultFuncs: deps.defaultFuncs,
    ctx: deps.ctx,
    jar: deps.ctx.jar,
    form: {
      av: deps.ctx.userID,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: friendlyName,
      doc_id: docId,
      variables: JSON.stringify(variables)
    }
  }).then((response: Loose) => {
    if (response?.errors?.length) throw response;
    cb(null, response);
  }).catch((error: Loose) => {
    deps.logError?.(scope, error);
    cb(error);
  });
  return promise;
}

export function createSocialDomain(deps: SocialDomainDeps) {
  const reactToComment = (
    commentID: string,
    reaction: string | number = "like",
    callback?: CallbackResult
  ) => {
    let cb = callback;
    let kind: string | number = reaction;
    if (typeof reaction === "function") {
      cb = reaction as unknown as CallbackResult;
      kind = "like";
    }
    const { callback: done, promise } = callbackPromise<Loose>(cb);
    try {
      const id = normalizeId(commentID, "commentID");
      const reactionId = typeof kind === "number" ? kind : REACTIONS[String(kind).toLowerCase()];
      if (!Number.isInteger(reactionId) || reactionId < 0 || reactionId > 16) {
        throw new Error("Invalid comment reaction");
      }
      const feedbackId = Buffer.from("feedback:" + id).toString("base64");
      const timestamp = String(Date.now());
      const variables = {
        input: {
          actor_id: deps.ctx.userID,
          feedback_id: feedbackId,
          feedback_reaction_id: reactionId,
          feedback_source: "TAHOE",
          is_tracking_encrypted: true,
          tracking: [],
          session_id: randomUUID(),
          downstream_share_session_id: randomUUID(),
          downstream_share_session_start_time: timestamp,
          client_mutation_id: "1"
        },
        useDefaultActor: false,
        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
      };
      runMutation(deps, "reactToComment", "CometUFIFeedbackReactMutation", "7616998081714004", variables,
        (error, result) => error ? done(error) : done(null, result));
    } catch (error) {
      deps.logError?.("reactToComment", error);
      done(error);
    }
    return promise;
  };

  const postComment = (
    postID: string,
    text: string,
    callback?: CallbackResult
  ) => {
    const { callback: done, promise } = callbackPromise<Loose>(callback);
    try {
      const id = normalizeId(postID, "postID");
      if (typeof text !== "string" || !text.trim()) throw new Error("Comment text is required");
      const feedbackId = Buffer.from("feedback:" + id).toString("base64");
      const mutationId = randomUUID();
      const variables = {
        feedLocation: "DEDICATED_COMMENTING_SURFACE",
        feedbackSource: 110,
        groupID: null,
        input: {
          client_mutation_id: mutationId.slice(0, 8),
          actor_id: deps.ctx.userID,
          attachments: null,
          feedback_id: feedbackId,
          formatting_style: null,
          message: { ranges: [], text },
          feedback_referrer: "/",
          is_tracking_encrypted: true,
          tracking: [],
          feedback_source: "DEDICATED_COMMENTING_SURFACE",
          idempotence_token: "client:" + mutationId,
          session_id: randomUUID()
        },
        inviteShortLinkKey: null,
        renderLocation: null,
        scale: 1,
        useDefaultActor: false,
        focusCommentID: null,
        __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
        __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
        __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
        __relay_internal__pv__IsWorkUserrelayprovider: false
      };
      runMutation(deps, "postComment", "useCometUFICreateCommentMutation", "33964973576450400", variables,
        (error, result) => error ? done(error) : done(null, result));
    } catch (error) {
      deps.logError?.("postComment", error);
      done(error);
    }
    return promise;
  };

  const sharePost = (
    postID: string,
    message = "",
    callback?: CallbackResult
  ) => {
    const { callback: done, promise } = callbackPromise<Loose>(callback);
    try {
      const id = normalizeId(postID, "postID");
      const shareScrapeData = JSON.stringify({ share_type: 22, share_params: [id] });
      const sessionId = randomUUID();
      const variables = {
        input: {
          composer_entry_point: "share_modal",
          composer_source_surface: "feed_story",
          composer_type: "share",
          idempotence_token: randomUUID() + "_FEED",
          source: "WWW",
          attachments: [{ link: { share_scrape_data: shareScrapeData } }],
          reshare_original_post: "RESHARE_ORIGINAL_POST",
          audience: { privacy: { allow: [], base_state: "EVERYONE", deny: [], tag_expansion_state: "UNSPECIFIED" } },
          is_tracking_encrypted: true,
          tracking: [],
          message: { ranges: [], text: String(message || "") },
          logging: { composer_session_id: sessionId },
          event_share_metadata: { surface: "timeline" },
          actor_id: deps.ctx.userID,
          client_mutation_id: "2"
        },
        feedLocation: "NEWSFEED",
        feedbackSource: 1,
        focusCommentID: null,
        gridMediaWidth: null,
        groupID: null,
        scale: 1,
        privacySelectorRenderLocation: "COMET_STREAM",
        checkPhotosToReelsUpsellEligibility: false,
        referringStoryRenderLocation: null,
        renderLocation: "homepage_stream",
        useDefaultActor: false,
        inviteShortLinkKey: null,
        isFeed: true,
        isFundraiser: false,
        isFunFactPost: false,
        isGroup: false,
        isEvent: false,
        isTimeline: false,
        isSocialLearning: false,
        isPageNewsFeed: false,
        isProfileReviews: false,
        isWorkSharedDraft: false,
        hashtag: null,
        canUserManageOffers: false,
        __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
        __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
        __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true
      };
      runMutation(deps, "sharePost", "ComposerStoryCreateMutation", "26264075519853494", variables,
        (error, result) => error ? done(error) : done(null, result));
    } catch (error) {
      deps.logError?.("sharePost", error);
      done(error);
    }
    return promise;
  };

  const shareLink = (
    url: string,
    threadID: string,
    text = "",
    callback?: NodeStyleCallback<Loose>
  ) => {
    const link = String(url || "").trim();
    if (!/^https?:\/\//i.test(link)) {
      const error = new Error("shareLink requires an http(s) URL");
      callback?.(error);
      return Promise.reject(error);
    }
    const body = [String(text || "").trim(), link].filter(Boolean).join("\n");
    return deps.sendMessage({ body }, String(threadID), callback);
  };

  return { shareLink, postComment, reactToComment, sharePost };
}
