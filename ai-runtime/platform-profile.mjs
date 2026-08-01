export const IOS_CHUNK_MAX_BYTES = 32 * 1024 * 1024;

export function isIOSUserAgent(
  userAgent,
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0
) {
  return /iPhone|iPad|iPod/.test(userAgent)
    || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function getLoaderProfile(
  userAgent = globalThis.navigator?.userAgent ?? "",
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0
) {
  if (!isIOSUserAgent(userAgent, maxTouchPoints)) return {};
  return {
    concurrency: 1,
    chunkMaxBytes: IOS_CHUNK_MAX_BYTES,
    diskBackedPle: true,
  };
}
