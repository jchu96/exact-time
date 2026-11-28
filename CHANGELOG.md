# Changelog

## 0.1.5

- Added `toOtioTime` and `toOtioRange` to Python and ExtendScript, matching the existing Node writers.
- Added file-clock positions in all three builds. Stream timestamps and audio sample counts can round-trip through OTIO at their original timescale. Tick and frame conversions report `INEXACT` between boundaries. Frame conversion also accepts an explicit start, end or instant edge.

## 0.1.4

- `fromOtioTime` and `fromOtioRange` (Node, Python and ExtendScript), first shipped in `0.1.4-beta.1`, are released unchanged. They read OpenTimelineIO `RationalTime.1` and `TimeRange.1` objects into exact frame times and refuse a value that is not a whole number of frames or a fractional rate that is not exactly an accepted rate.

## 0.1.4-beta.1

Pre-release.

- Added `fromOtioTime` and `fromOtioRange` in Node, Python and ExtendScript. They read OpenTimelineIO `RationalTime.1` and `TimeRange.1` objects into exact frame times. A value must be a whole number of frames. A rate is accepted when its double equals a named rate, when it is a positive whole number, or when the caller passes a matching rational rate; any other fractional rate is refused.
- A tag with a pre-release suffix is published as a GitHub pre-release and is not marked Latest.

## 0.1.3

- Added `MEDIA_CLOCKS` and `mediaClockSchema.parse(value)` in Node, Python and ExtendScript so callers can validate stored clock names with the same rule as conversions.

## 0.1.2

- Node applications can install the prebuilt package with npm or Bun from a versioned GitHub release URL. The release includes the tarball in `SHA256SUMS` alongside the standalone files.

## 0.1.1

- Python accepts whole-valued float rates on the exact tick path and other rate inputs. Omitting the drop-frame choice in `renderExactTimecode` raises `INVALID_TIMECODE`.
- Added `ticksAtGrid` and `fromContainingTicks` to the Node builds and Python, matching the existing ExtendScript functions.
- Conversion refusals carry a stable `code` across all three forms. Existing messages and exception types are preserved.
- Added eight tick cases to the shared contract and release-file tests for public names and refusal codes.

## 0.1.0

- Initial standalone release of exact frame-time conversions for TypeScript, Python and ExtendScript.
- Includes the version 2 case table, an independent arithmetic checker and SHA-256 fingerprints for the release files.
- TypeScript rate validators now throw a plain `RangeError` or `TypeError` with a message and no `issues` array. Consumers migrating from the earlier in-tool module should use the message and remove dependencies on the schema library’s error shape. Getters that mutate a rate object during validation can change the outcome.
- Python accepts ASCII digits in whole-number text and preserves millisecond counts longer than 4,300 digits.

### Known gaps

- The oracle repeats the production division for legacy millisecond and tick conversions. These paths still need an independent arithmetic check.
