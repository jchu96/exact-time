# Changelog

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
