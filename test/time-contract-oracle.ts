// Independent contract oracle: sequential labels, not the production DF formula.
// A ten-minute cycle repeats; skip whole cycles for unbounded hours.
export type Case = {
  id: string; op: string; input: string; clock?: "source" | "reel" | "timeline";
  rate?: { num: number; den: number }; dropFrame?: boolean; offset?: string;
  expected?: Record<string, unknown>; refused?: string; otio?: { differs: boolean; reason: string };
};
const cycles = new Map<string, string[]>();
export function oracleLabel(frame: bigint, num: number, den: number, drop: boolean): string {
  const nominal = Number((BigInt(num) + BigInt(den) - 1n) / BigInt(den));
  const key = `${nominal}/${drop}`;
  if (!cycles.has(key)) {
    const labels: string[] = [];
    let minute = 0, second = 0, field = 0;
    while (minute < 10) {
      labels.push(`${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${drop ? ";" : ":"}${String(field).padStart(2, "0")}`);
      if (++field === nominal) {
        field = 0;
        if (++second === 60) { second = 0; minute++; if (drop && minute % 10 !== 0) field = nominal === 60 ? 4 : 2; }
      }
    }
    cycles.set(key, labels);
  }
  const labels = cycles.get(key)!;
  const cycle = frame / BigInt(labels.length);
  const label = labels[Number(frame % BigInt(labels.length))]!;
  const minute = cycle * 10n + BigInt(label.slice(0, 2));
  return `${String(minute / 60n).padStart(2, "0")}:${String(minute % 60n).padStart(2, "0")}${label.slice(2)}`;
}
function rateParts(row: Pick<Case, "rate">) {
  let num = BigInt(row.rate?.num ?? 1000), den = BigInt(row.rate?.den ?? 1);
  let a = num, b = den;
  while (b !== 0n) { const r = a % b; a = b; b = r; }
  num /= a; den /= a;
  return { num, den };
}
/** Each accepted row is recomputed from its input, never from its expected frame. */
export function oracle(row: Case): Record<string, unknown> {
  if (row.op === "rate") {
    const aliases: Record<string, [number, number, boolean]> = {
      "48000/2002": [24000,1001,false], "23.976": [24000,1001,false], "47.952": [48000,1001,false],
      "29.97ndf": [30000,1001,false], "59.94df": [60000,1001,true],
    };
    const [num, den, dropFrame] = aliases[row.input]!;
    return { rate: { num, den }, dropFrame, rateOrigin: "declared" };
  }
  const { num, den } = rateParts(row);
  let frames: bigint;
  switch (row.op) {
    case "milliseconds": frames = BigInt(row.input) * num / (1000n * den); break;
    case "ticks": frames = BigInt(row.input) * num / (254016000000n * den); break;
    case "offset": frames = BigInt(row.input) + BigInt(row.offset!); break;
    case "timecode": {
      // Search the independently counted labels for this bounded table input.
      frames = 0n;
      while (oracleLabel(frames, Number(num), Number(den), row.dropFrame!) !== row.input) {
        if (++frames > 40000n) throw new Error(`Oracle label not found: ${row.id}`);
      }
      break;
    }
    case "frames": frames = BigInt(row.input); break;
    default: throw new Error(`Unknown oracle operation: ${row.op}`);
  }
  // Definition of first integer ms inside a frame, via quotient/remainder.
  const numerator = frames * den * 1000n;
  let ms = numerator / num;
  if (numerator % num !== 0n) ms++;
  const result: Record<string, unknown> = { clock: row.clock, secondsDerived: true };
  // An integer reading value must lie strictly before the next frame boundary.
  if (ms * num < (frames + 1n) * den * 1000n) result.seconds = `${ms / 1000n}.${String(ms % 1000n).padStart(3, "0")}`;
  else result.secondsUnavailable = "No whole millisecond falls inside this frame; three-decimal derived seconds are unavailable.";
  if (254016000000n * den % num !== 0n) result.ticksUnavailable = "Ticks per frame are not whole at this rate.";
  else result.ticks = String(frames * (254016000000n * den / num));
  if (!row.rate) return { ...result, milliseconds: String(frames), rateBasis: "whole-millisecond source; no declared video rate" };
  return { ...result, frames: String(frames), rate: { num: Number(num), den: Number(den) },
    timecode: oracleLabel(frames, Number(num), Number(den), row.dropFrame!), dropFrame: row.dropFrame };
}
/** Independent reason classification for every negative table input. */
export function oracleRefusal(row: Case): string {
  if (row.op === "rate") return "Unsupported or ambiguous timecode rate.";
  const { num, den } = rateParts(row);
  if (row.op !== "timecode") {
    if (row.input.trim() !== row.input || !/^(0|[1-9][0-9]*)$/.test(row.input)) return "Expected a non-negative unpadded whole number.";
    if (row.op === "ticks") return 254016000000n * den % num !== 0n
      ? "Ticks per frame are not whole at this rate." : "Ticks must identify an exact frame boundary.";
  }
  if (row.dropFrame === undefined) return "Drop-frame must be stated.";
  if (row.dropFrame && !(den === 1001n && (num === 30000n || num === 60000n))) return "Drop-frame requires 30000/1001 or 60000/1001.";
  const fields = row.input.split(/[:;]/);
  if (row.input.trim() !== row.input || fields.length !== 4 || fields.some(f => !/^\d{2,}$/.test(f)) || Number(fields[1]) >= 60 || Number(fields[2]) >= 60) return "Malformed timecode.";
  if (row.input.includes(";") !== row.dropFrame) return "Timecode separator must match the stated drop-frame choice.";
  if (BigInt(fields[3]!) * den >= num) return "Frame field must be below the nominal rate.";
  if (row.dropFrame && Number(fields[1]) % 10 !== 0 && fields[2] === "00" && Number(fields[3]) < (num === 60000n ? 4 : 2)) return "Drop-frame label does not exist.";
  throw new Error(`Refusal not independently justified: ${row.id}`);
}

/** Walk frame boundaries for the bounded decimal fixtures. */
function oracleSnap(input: string, edge: "start" | "end" | "instant", num: bigint, den: bigint) {
  const [seconds, fraction = ""] = input.split(".");
  const scale = BigInt("1" + "0".repeat(fraction.length));
  const asked = (BigInt(seconds!) * scale + BigInt(fraction)) * num;
  const step = den * scale;
  let frame = 0n;
  while ((frame + 1n) * step <= asked) frame++;
  if (edge === "start" && frame * step < asked) frame++;
  const difference = frame * step - asked;
  let divisor = num * scale;
  let remainder = difference;
  while (remainder !== 0n) [divisor, remainder] = [remainder, divisor % remainder];
  if (divisor < 0n) divisor = -divisor;
  return {
    frames: String(frame), askedSeconds: input, edge, moved: difference !== 0n,
    movement: { numerator: String(difference / divisor), denominator: String(num * scale / divisor) },
  };
}

export function entryOracle(row: EntryCase): Record<string, unknown> | string {
  const num = BigInt(row.rate.num), den = BigInt(row.rate.den);
  if (row.op === "snapDecimalSeconds") return oracleSnap(row.input, row.edge, num, den);
  if (row.op === "snapRange") {
    const startFrame = oracleSnap(row.input, "start", num, den).frames;
    const endFrame = oracleSnap(row.endInput, "end", num, den).frames;
    return { startFrame, endFrame, empty: BigInt(startFrame) >= BigInt(endFrame) };
  }

  if (num > 1000n * den) return "Above 1000 fps two frames can share one whole millisecond.";
  const frameStep = den * 1000n;
  if (row.op === "toPremiereMilliseconds") {
    // Count whole millisecond boundaries up to and including the frame start.
    const start = BigInt(row.input) * frameStep;
    let ms = 0n;
    while ((ms + 1n) * num <= start) ms++;
    return { milliseconds: String(ms) };
  }
  const ms = BigInt(row.input);
  let frame = 0n;
  while (frame * frameStep < ms * num) frame++;
  if (frame * frameStep < (ms + 1n) * num) return { frames: String(frame) };
  return `No frame writes ${ms} ms. It falls between the values written by frames ${frame - 1n} and ${frame}.`;
}

export type EntryCase = {
  id: string; input: string; rate: { num: number; den: number };
  clock: "source" | "reel" | "timeline";
  expected?: Record<string, unknown>; refused?: string;
  basis: "observed in an editing application" | "worked by hand";
} & (
  | { op: "snapDecimalSeconds"; edge: "start" | "end" | "instant" }
  | { op: "snapRange"; endInput: string }
  | { op: "fromPremiereMilliseconds" | "toPremiereMilliseconds" }
);

export type TickCase = { id: string; expected?: unknown; refused?: string } & (
  | { op: "ticksAtGrid"; frames: string; grid: string }
  | { op: "fromContainingTicks"; ticks: string; clock: string; rate?: { num: number; den: number } }
);

export function tickOracle(row: TickCase) {
  if (row.op === "ticksAtGrid") {
    const grid = BigInt(row.grid);
    if (grid === 0n) return "INVALID_INPUT";
    // Add by doubling so either operand may exceed the safe integer range.
    let ticks = 0n, frames = BigInt(row.frames);
    for (let copies = grid; copies > 0n; copies >>= 1n) {
      if (copies & 1n) ticks += frames;
      frames += frames;
    }
    return String(ticks);
  }
  const { num, den } = rateParts(row);
  const frame = 254016000000n * den;
  if (frame % num !== 0n) return "UNREPRESENTABLE";
  const instant = BigInt(row.ticks) * num;
  let count = 0n;
  while ((count + 1n) * frame <= instant) count++;
  return { clock: row.clock, frames: String(count), rate: { num: Number(num), den: Number(den) },
    unit: row.rate ? "video-frame" : "millisecond" };
}

type OtioTimeSample = { OTIO_SCHEMA: "RationalTime.1"; value: number; rate: number };
type FilePositionRow = { clock: string; count: string; timescale: string };
type FileWriterRow = FilePositionRow & { op: "toOtioFileTime" };
export type FileCase = { id: string; expected?: unknown; refused?: string } & (
  | FileWriterRow
  | (FilePositionRow & { op: "fileTime" | "fileTimeToTicks" })
  | (FilePositionRow & { op: "fileTimeToFrames"; rate: { num: number; den: number }; edge?: string })
  | { op: "fromOtioFileTime"; clock: string; input: { OTIO_SCHEMA?: string; value: number; rate: number } }
);

// Find the enclosing boundaries by comparison, independently of production division.
function containingUnit(instant: bigint, step: bigint) {
  let lo = 0n, hi = 1n;
  while (hi * step <= instant) hi *= 2n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) >> 1n;
    if (mid * step <= instant) lo = mid;
    else hi = mid;
  }
  return { lower: lo, onBoundary: lo * step === instant };
}

export function fileOracle(row: FileCase) {
  const { clock } = row;
  if (!["source", "reel", "timeline"].includes(clock)) return "INVALID_INPUT";
  if (row.op === "fromOtioFileTime") {
    const { OTIO_SCHEMA, value, rate } = row.input;
    if (OTIO_SCHEMA !== "RationalTime.1" || !Number.isInteger(value) || value < 0) return "INVALID_INPUT";
    if (!Number.isSafeInteger(value)) return "UNREPRESENTABLE";
    if (!Number.isSafeInteger(rate) || rate < 1) return "INVALID_RATE";
    return { clock, count: String(value), timescale: String(rate) };
  }
  if (!/^(0|[1-9][0-9]*)$/.test(row.count) || !/^[1-9][0-9]*$/.test(row.timescale)) return "INVALID_INPUT";
  const count = BigInt(row.count), scale = BigInt(row.timescale);
  switch (row.op) {
    case "fileTime": return { clock, count: row.count, timescale: row.timescale };
    case "toOtioFileTime":
      if (count >= 2n ** 53n || scale >= 2n ** 53n) return "UNREPRESENTABLE";
      return { OTIO_SCHEMA: "RationalTime.1", value: Number(count), rate: Number(scale) };
    case "fileTimeToTicks": {
      const ticks = containingUnit(count * 254016000000n, scale);
      return ticks.onBoundary ? String(ticks.lower) : "INEXACT";
    }
    case "fileTimeToFrames": {
      const { rate, edge } = row;
      if (![rate.num, rate.den].every(n => Number.isSafeInteger(n) && n > 0)) return "INVALID_RATE";
      if (edge !== undefined && !["start", "end", "instant"].includes(edge)) return "INVALID_INPUT";
      const { num, den } = rateParts(row);
      const frame = containingUnit(count * num, scale * den);
      if (!frame.onBoundary && edge === undefined) return "INEXACT";
      return { clock, frames: String(frame.lower + (edge === "start" && !frame.onBoundary ? 1n : 0n)),
        rate: { num: Number(num), den: Number(den) }, unit: "video-frame" };
    }
  }
}

export type OtioCase = { id: string; clock: string; rate?: { num: number; den: number }; expected?: unknown; refused?: string } & (
  | FileWriterRow
  | { op: "toOtioTime"; frames: string; rate: { num: number; den: number } }
  | { op: "toOtioRange"; frames: string; duration: string; durationClock: string; rate: { num: number; den: number } }
  | { op: "fromOtioTime"; input: OtioTimeSample }
  | { op: "fromOtioRange"; input: { OTIO_SCHEMA: "TimeRange.1"; start_time: OtioTimeSample; duration: OtioTimeSample } }
);

export function otioOracle(row: OtioCase) {
  if (row.op === "toOtioFileTime") return fileOracle(row);
  if (row.op === "toOtioTime" || row.op === "toOtioRange") {
    const rate = row.rate.num / row.rate.den;
    const sample = (frames: string) => ({ OTIO_SCHEMA: "RationalTime.1", value: Number(frames), rate });
    if (row.op === "toOtioRange" && row.clock !== row.durationClock) return "INVALID_INPUT";
    if (BigInt(row.frames) >= 2n ** 53n || (row.op === "toOtioRange" && BigInt(row.duration) >= 2n ** 53n))
      return "UNREPRESENTABLE";
    if (row.op === "toOtioTime") return sample(row.frames);
    return { OTIO_SCHEMA: "TimeRange.1", start_time: sample(row.frames), duration: sample(row.duration) };
  }
  // The fractional doubles in these fixtures were observed in a timeline export.
  function time({ value, rate }: OtioTimeSample) {
    if (value < 0 || !Number.isInteger(value)) return "INVALID_INPUT";
    if (BigInt(value) >= 2n ** 53n) return "UNREPRESENTABLE";
    let rational;
    if (row.rate) {
      const { num, den } = rateParts(row);
      rational = { num: Number(num), den: Number(den) };
      if (rate !== rational.num / rational.den) return "INVALID_RATE";
    } else if (rate === 23.976023976023978) {
      rational = { num: 24000, den: 1001 };
    } else if (rate === 29.97002997002997) {
      rational = { num: 30000, den: 1001 };
    } else if (Number.isSafeInteger(rate) && rate > 0) {
      rational = { num: rate, den: 1 };
    } else {
      throw new Error(`No independent OTIO fixture rate for ${row.id}`);
    }
    return { clock: row.clock, frames: String(value), rate: rational, unit: "video-frame" };
  }
  if (row.op === "fromOtioTime") return time(row.input);
  return { start: time(row.input.start_time), duration: time(row.input.duration) };
}
