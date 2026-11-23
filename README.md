# exact-time

A video timestamp can fall between two frames. exact-time lets an editing panel, a Python script and a Node application agree on which frame to use, even when the frame rate is fractional.

## Which time do you have?

| Input | Entry point | Frame selection |
| --- | --- | --- |
| Decimal seconds, as text | `snapDecimalSeconds(clock, seconds, rate, edge)` | `"start"` rounds up to the next boundary, `"end"` rounds down, and `"instant"` picks the frame containing the time. An exact boundary stays put. The edge is required. |
| Whole milliseconds an editor wrote by rounding a frame start down | `fromPremiereMilliseconds(clock, ms, rate)` | Recovers the frame that wrote that value. A gap reports the neighboring frames. `toPremiereMilliseconds(time)` writes the value back. Both entries accept rates up to and including 1000 frames per second. |
| A whole frame count or a tick count on a frame boundary | `exactTime(clock, frames, rate)` or `fromTicks(clock, ticks, rate)` | Preserves the exact position. The tick grid has 254,016,000,000 ticks per second. |

Pass counts as decimal strings and choose the clock the value belongs to (`source`, `reel` or `timeline`). A range is empty when its selected start is at or beyond its selected end.

**At 24000/1001 fps**, frame 300 starts at 12.5125 seconds. An editor writes it as 12512 whole milliseconds. Reading `"12512"` with `fromPremiereMilliseconds` returns frame 300. Given `"12.512"` as decimal seconds instead, the instant is still in frame 299, and a range starting there begins at frame 300.

## Use a release

From a checkout of this repository, download all assets for the chosen tag into a new directory and verify their SHA-256 fingerprints. Keep the tag and the verified fingerprint of each file you use with your application.

```sh
gh release download v0.1.0 --dir exact-time-v0.1.0
(cd exact-time-v0.1.0 && shasum -a 256 -c SHA256SUMS)
```

On Linux, `sha256sum --check SHA256SUMS` also verifies the download. On a subsequent install, compare the downloaded files against your saved fingerprints.

**Node.js** — Copy `exact-time.mjs` and its TypeScript declaration `exact-time.d.mts` beside your code. CommonJS callers use `require("./exact-time.cjs")` with `exact-time.d.cts` alongside it.

```js
import { snapDecimalSeconds } from "./exact-time.mjs";

const film = { num: 24000, den: 1001 };
const cut = snapDecimalSeconds("timeline", "12.512", film, "start");
console.log(cut.frames); // 300n
```

**Python** — Copy `exact_time.py` beside your script. It uses the standard library.

```python
from exact_time import fromPremiereMilliseconds

film = {"num": 24000, "den": 1001}
print(fromPremiereMilliseconds("timeline", "12512", film)["frames"])  # 300
```

**ExtendScript panel** — Copy `exact-time.jsx` beside the panel’s host script and include it before calling `ExactTime`. The ES3 implementation returns frame counts as decimal strings.

```js
#include "exact-time.jsx"
var film = { num: 24000, den: 1001 };
var frame = ExactTime.exactTime("timeline", "300", film);
var ms = ExactTime.toPremiereMilliseconds(frame); // "12512"
```

## Test and build

Use Node 22.12+ or 24 and Python 3.11 or 3.13. With `python3` on your path, run:

```sh
npm ci
npm run check
```

The suite checks clock types, the independent oracle, and all 99 contract rows against both Node builds, Python and the ES3 file. The ES3 tests use Node’s VM. The table and the two design records explain the conversion rules. [Case table](contracts/time-cases.json) · [Exact frames](docs/adr/0027-exact-rational-frame-times.md) · [Choosing a frame](docs/adr/0028-time-to-frame.md)

Run `npm run release` to rebuild the standalone files and their `SHA256SUMS` manifest in `dist/`. A matching version tag such as `v0.1.0` attaches those files to a GitHub release after the test matrix passes.

Distributed under the [MIT license](LICENSE).
