import { fail } from "./refusal.js";

export type FrameRate = { num: number; den: number };
export type TimecodeSpec = { rate: FrameRate; dropFrame: boolean; rateOrigin: "declared" | "media" };

function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_RATE", new TypeError("Expected an object."));
  }
  for (const key in value) {
    if (!allowed.includes(key)) fail("INVALID_RATE", new TypeError(`Unexpected field: ${key}`));
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("INVALID_RATE", new RangeError("Rate must contain positive safe whole numbers."));
  }
  return value;
}

function validator<T>(parse: (value: unknown) => T) {
  return {
    parse,
    safeParse(value: unknown) {
      try { return { success: true as const, data: parse(value) }; }
      catch (error) { return { success: false as const, error }; }
    },
  };
}

export const rateSchema = validator((value): FrameRate => {
  const { num, den } = fields(value, ["num", "den"]);
  return { num: positiveInteger(num), den: positiveInteger(den) };
});

export const timecodeSpecSchema = validator((value): TimecodeSpec => {
  const spec = fields(value, ["rate", "dropFrame", "rateOrigin"]);
  const rate = rateSchema.parse(spec.rate);
  const { dropFrame, rateOrigin } = spec;
  if (typeof dropFrame !== "boolean" || (rateOrigin !== "declared" && rateOrigin !== "media")) {
    fail("INVALID_RATE", new TypeError("Expected a drop-frame choice and declared or media rate origin."));
  }
  if (dropFrame && !isDropRate(rate)) fail("INVALID_RATE", new RangeError("Drop-frame requires 30000/1001 or 60000/1001."));
  return { rate, dropFrame, rateOrigin };
});

export const ACCEPTED_RATES = "24, 25, 30, 48, 50, 60; 23.976, 47.952; 29.97df, 29.97ndf, 59.94df, 59.94ndf; N/D (optionally :df or :ndf); from-media, from-media:df, from-media:ndf";
export function rateError(): never { fail("INVALID_RATE", new Error(`Unsupported or ambiguous timecode rate. Accepted forms: ${ACCEPTED_RATES}. Drop-frame must be stated for 30000/1001 and 60000/1001.`)); }
export function rationalRate(num: number, den: number): FrameRate {
  rateSchema.parse({ num, den });
  let a = num; let b = den;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return { num: num / a, den: den / a };
}
export function isDropRate(rate: FrameRate): boolean {
  try {
    return BigInt(rate.num) * BigInt(1001) === BigInt(30000) * BigInt(rate.den)
      || BigInt(rate.num) * BigInt(1001) === BigInt(60000) * BigInt(rate.den);
  } catch (error) {
    return fail("INVALID_RATE", error as Error);
  }
}
export function parseTimecodeRate(value: string): TimecodeSpec {
  const match = /^(.*?)(?::?(ndf|df))?$/.exec(value);
  if (!match || match[0] !== value) rateError();
  const name = match[1]!; const choice = match[2];
  const aliases: Record<string, FrameRate> = {
    "23.976": { num: 24000, den: 1001 }, "47.952": { num: 48000, den: 1001 },
    "29.97": { num: 30000, den: 1001 }, "59.94": { num: 60000, den: 1001 },
  };
  let rate = Object.hasOwn(aliases, name) ? aliases[name] : undefined;
  if (!rate && /^(24|25|30|48|50|60)$/.test(name)) rate = { num: Number(name), den: 1 };
  if (!rate && /^[1-9]\d*\/[1-9]\d*$/.test(name)) {
    const [num, den] = name.split("/").map(Number);
    try { rate = rationalRate(num!, den!); } catch { rateError(); }
  }
  if (!rate || (isDropRate(rate) && !choice) || (choice === "df" && !isDropRate(rate))) rateError();
  return { rate, dropFrame: choice === "df", rateOrigin: "declared" };
}
