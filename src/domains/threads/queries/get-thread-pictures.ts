import { createLegacyPromise } from "../../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../../compat/callbackify";
import { postSharedPhotosRequest } from "../../../transport/http/shared-photos";

export interface GetThreadPicturesQueryDeps {
  defaultFuncs: {
    post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
  };
  ctx: {
    jar: Loose;
  };
  logError?: (scope: string, error: Loose) => void;
}

export function createGetThreadPicturesQuery(deps: GetThreadPicturesQueryDeps) {
  const { defaultFuncs, ctx, logError } = deps;

  return function getThreadPictures(
    threadID: string,
    offset: number,
    limit: number,
    callback?: NodeStyleCallback<Loose[]>
  ) {
    const { callback: cb, promise } = createLegacyPromise<Loose[]>(callback, []);
    if (!threadID || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit <= 0) {
      cb(new Error("getThreadPictures: threadID, non-negative offset and positive limit are required"));
      return promise;
    }

    postSharedPhotosRequest({
      defaultFuncs,
      ctx,
      form: {
        thread_id: threadID,
        offset,
        limit
      }
    })
      .then((resData: Loose) => {
        if (resData.error) {
          throw resData;
        }

        const images = resData?.payload?.imagesData;
        if (!Array.isArray(images)) {
          throw new Error("getThreadPictures: invalid image list response");
        }

        return Promise.all(
          images.filter((image: Loose) => image?.fbid != null).map((image: Loose) =>
            postSharedPhotosRequest({
              defaultFuncs,
              ctx,
              form: {
                thread_id: threadID,
                image_id: image.fbid
              }
            }).then((detail: Loose) => {
              if (detail.error) {
                throw detail;
              }

              const module = detail?.jsmods?.require?.[0]?.[3]?.[1];
              const queryThreadID = module?.query_metadata?.query_path?.[0]?.message_thread;
              const edges = queryThreadID
                ? module?.query_results?.[queryThreadID]?.message_images?.edges
                : null;
              return Array.isArray(edges) ? edges[0]?.node?.image2 || null : null;
            })
          )
        );
      })
      .then((pictures: Loose[]) => {
        cb(null, pictures);
      })
      .catch((error: Loose) => {
        logError?.("Error in getThreadPictures", error);
        cb(error);
      });

    return promise;
  };
}
