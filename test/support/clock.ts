// Upstream compatibility callers exercised by the runtime and type tests.
import { fromMilliseconds, renderExactTimecode } from "../../src/domain/exact-time.js";
import type { FrameRate } from "../../src/domain/time-rate.js";
import type { MediaClock } from "../../src/domain/media-clock.js";

declare const clockBrand: unique symbol;
export type ClockTime<C extends string = MediaClock> = {
  clock: C; ms: number; precisionMs: number; readonly [clockBrand]: C;
};
export type SourceTime = ClockTime<"source">;
export type FileClock = "source" | "reel";

export function clockTime<C extends string>(clock: C, ms: number, precisionMs = 1000): ClockTime<C> {
  if (!Number.isSafeInteger(ms) || !Number.isSafeInteger(precisionMs) || precisionMs < 0) {
    throw new Error("Clock values must be safe integer milliseconds.");
  }
  return { clock, ms, precisionMs } as ClockTime<C>;
}

export function sourceToTimeline(time: SourceTime, offsetMs: number): ClockTime<"timeline"> {
  return fileToTimeline(time, offsetMs);
}
export function fileToTimeline(time: ClockTime<FileClock>, offsetMs: number): ClockTime<"timeline"> {
  if (!Number.isSafeInteger(offsetMs) || offsetMs < 0) throw new Error("Invalid timeline offset.");
  return clockTime("timeline", time.ms + offsetMs, time.precisionMs);
}

/** Compatibility rendering: the frame containing the whole-millisecond instant. */
export function renderTimecode(ms: number, rate: FrameRate, dropFrame: boolean): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("Timecode requires non-negative integer milliseconds.");
  return renderExactTimecode(fromMilliseconds("source", String(ms), rate), dropFrame);
}
