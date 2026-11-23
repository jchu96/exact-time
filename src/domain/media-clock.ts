export const MEDIA_CLOCKS = Object.freeze(["source", "reel", "timeline"] as const);
export type MediaClock = (typeof MEDIA_CLOCKS)[number];
