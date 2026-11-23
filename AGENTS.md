# Working on exact-time

## Package manager

- Install pinned development tools with `npm ci`.
- Run the same full suite as CI with `npm run check`. Build the release with `npm run release`.

## File-scoped commands

- Run one TypeScript suite with `npx vitest run test/exact-time-entries.test.ts`.
- Check the branded clock types with `npx tsc --noEmit`.
- Run the Python table with `python3 -I test/test_python.py`.
- After building, exercise the ES3 file with `node test/test_table.mjs --es3`.

## Conversion changes

- Keep all three implementations in agreement with `contracts/time-cases.json`. Preserve the oracle’s independent arithmetic and its isolation test.
- Read the [frame representation](docs/adr/0027-exact-rational-frame-times.md) and [entry rules](docs/adr/0028-time-to-frame.md) before changing conversion behavior.

## The three forms are one library

- Change the TypeScript, Python and ES3 forms together. `test/api-parity.test.mjs` compares their public names and refusal codes from the built files; keep it green and add a probe for every new refusal.
- Add case-table rows; never change an existing row, message text or exception type. Callers pin a release and read them.
- Keep `es3/exact-time.jsx` free of syntax newer than ES3 (`node test/test_table.mjs --es3` checks it).

## Review and release

- A code change gets one independent review at the exact head that will merge. A documents-only change needs the automatic checks and no review.
- Never commit working papers (`BRIEF-*`, `STATUS-*`, `REVIEW-*`, `STEER-*`, `MUTANTS-*`).
- Release: set the version in `package.json` and `package-lock.json`, add the `CHANGELOG.md` entry, merge, and wait for CI on `main` to pass at that commit. Then push the tag `vX.Y.Z`; the workflow attaches the files and `SHA256SUMS`.
- A release is not done until it has been downloaded and checked: `gh release download vX.Y.Z --dir <new-dir>` then `shasum -a 256 -c SHA256SUMS` in that directory.

## Commit attribution

- Include a `Co-Authored-By` trailer with the contributing agent’s byline for AI-assisted changes.
