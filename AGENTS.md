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

## Commit attribution

- Include a `Co-Authored-By` trailer with the contributing agent’s byline for AI-assisted changes.
