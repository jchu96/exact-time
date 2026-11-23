import { expect, test } from "vitest";
import { z } from "zod";
import { rateSchema, timecodeSpecSchema } from "../src/domain/time-rate.js";

// The original validators are a test-only reference for the public input boundary.
const positive = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).min(1);
const originalRate = z.strictObject({ num: positive, den: positive });
const originalSpec = z.strictObject({
  rate: originalRate, dropFrame: z.boolean(), rateOrigin: z.enum(["declared", "media"]),
}).refine(({ rate, dropFrame }) => !dropFrame ||
  [30000n, 60000n].some(num => BigInt(rate.num) * 1001n === num * BigInt(rate.den)));

function compare<T>(
  original: { parse(value: unknown): T }, replacement: { parse(value: unknown): T }, value: unknown,
) {
  let expected: T;
  try { expected = original.parse(value); }
  catch {
    expect(() => replacement.parse(value)).toThrow();
    return;
  }
  expect(replacement.parse(value)).toEqual(expected);
}

test("rate fields accept exactly the original safe whole-number boundaries and object shapes", () => {
  const inputs: unknown[] = [null, false, 1, "1/1", [], {}, { num: 1 }, { den: 1 },
    { num: 1, den: 1, extra: 0 }, Object.create({ num: 1, den: 1 }),
    Object.assign(Object.create({ extra: 1 }), { num: 1, den: 1 }),
    JSON.parse('{"num":1,"den":1,"__proto__":1}'), { num: 1, den: 1, [Symbol()]: true }];
  for (const field of [1, 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -0, 0, -1,
    1.25, Infinity, -Infinity, NaN, null, undefined, "1", true, 1n]) {
    inputs.push({ num: field, den: 1 }, { num: 1, den: field });
  }
  for (const value of inputs) {
    compare(originalRate, rateSchema, value);
    compare(originalSpec, timecodeSpecSchema, { rate: value, dropFrame: false, rateOrigin: "media" });
  }
});

test("timecode validation retains strict keys, rate origins and the two rational drop-frame rates", () => {
  for (const num of [24000, 30000, 60000, 120000]) {
    for (const den of [1, 1001, 2002]) {
      for (const dropFrame of [false, true, "true", 1, undefined]) {
        for (const rateOrigin of ["declared", "media", "other", undefined]) {
          compare(originalSpec, timecodeSpecSchema, { rate: { num, den }, dropFrame, rateOrigin });
        }
      }
    }
  }
  const spec = { rate: { num: 25, den: 1 }, dropFrame: false, rateOrigin: "media" };
  for (const value of [null, [], {}, { ...spec, extra: 1 }, { ...spec, rate: { ...spec.rate, extra: 1 } }]) {
    compare(originalSpec, timecodeSpecSchema, value);
  }
});
