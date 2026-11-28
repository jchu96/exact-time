export type RefusalCode = "INVALID_INPUT" | "INVALID_RATE" | "INVALID_TIMECODE" | "NOT_ON_FRAME_BOUNDARY" | "UNREPRESENTABLE" | "INEXACT";

export function fail(code: RefusalCode, error: Error): never {
  throw Object.assign(error, { code });
}
