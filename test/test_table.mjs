import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as nodeTime from '../dist/exact-time.mjs';
const here = name => fileURLToPath(new URL(name, import.meta.url));
const es = process.argv.includes('--es3');
const alternate = process.argv.find(a => a.startsWith('--table='))?.slice(8);
const canonical = readFileSync(here('../contracts/time-cases.json'));
if (alternate) assert.deepEqual(readFileSync(alternate), canonical, 'table differs from the repository contract');
const table = JSON.parse(canonical);
const cjs = process.argv.includes('--cjs');
let t = cjs ? (await import('../dist/exact-time.cjs')).default : nodeTime;
if (es) {
  execFileSync('python3', ['-I', here('check_es3.py'), here('../es3/exact-time.jsx')], {stdio:'inherit'});
  const context = vm.createContext({});
  vm.runInContext(readFileSync(here('../es3/exact-time.jsx'), 'utf8'), context, {timeout:5000});
  t = context.ExactTime;
  console.log("ES3 vm run is not Premiere's engine; no live-engine claim.");
}
let legacyCount = 0, entryCount = 0;
for (const c of table.cases) {
  try {
    let got;
    if (c.op === 'rate') got = t.parseTimecodeRate(c.input);
    else {
      const time = c.op === 'offset'
        ? t.offsetTime(t.exactTime('source', c.input, c.rate), t.exactTime(c.clock, c.offset, c.rate))
        : t[{frames:'exactTime', milliseconds:'fromMilliseconds', ticks:'fromTicks', timecode:'fromTimecode'}[c.op]](c.clock, c.input, c.rate, c.dropFrame);
      got = t.deriveExact(time, c.dropFrame);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(got)), c.expected, `MISS ${c.id}`);
    if (got.frames) {
      if (got.ticks) assert.equal(String(t.fromTicks(got.clock, got.ticks, got.rate).frames), got.frames, `MISS inverse ticks ${c.id}`);
      assert.equal(String(t.fromTimecode(got.clock, got.timecode, got.rate, got.dropFrame).frames), got.frames, `MISS inverse tc ${c.id}`);
    }
  } catch (error) {
    if (!c.refused || !error.message.startsWith(c.refused)) throw Error(`MISS ${c.id}: ${error.message}`);
  }
  legacyCount++;
}

function runEntry({op, clock, input, endInput, rate, edge, expected}) {
  if (op === 'snapRange') {
    const start = t.snapDecimalSeconds(clock, input, rate, 'start').frames;
    const end = t.snapDecimalSeconds(clock, endInput, rate, 'end').frames;
    return {startFrame:String(start), endFrame:String(end), empty:BigInt(start) >= BigInt(end)};
  }
  if (op === 'toPremiereMilliseconds') {
    const milliseconds = t.toPremiereMilliseconds(t.exactTime(clock, input, rate));
    if (expected) assert.equal(String(t.fromPremiereMilliseconds(clock, milliseconds, rate).frames), input);
    return {milliseconds};
  }
  if (op === 'fromPremiereMilliseconds') {
    const time = t.fromPremiereMilliseconds(clock, input, rate);
    if (expected) assert.equal(t.toPremiereMilliseconds(time), input, 'MISS inverse ms ' + input);
    return {frames:String(time.frames)};
  }
  assert.equal(op, 'snapDecimalSeconds');
  const time = t.snapDecimalSeconds(clock, input, rate, edge);
  return {frames:String(time.frames), askedSeconds:time.askedSeconds, edge:time.edge, moved:time.moved,
    movement:{numerator:String(time.movement.numerator), denominator:String(time.movement.denominator)}};
}

for (const c of table.entryCases) {
  if (c.refused)
    assert.throws(() => runEntry(c), error => error.message.startsWith(c.refused) && error.message.includes('Accepted forms:'), 'MISS ' + c.id);
  else
    assert.deepEqual(runEntry(c), c.expected, 'MISS ' + c.id);
  entryCount++;
}
assert.deepEqual([legacyCount, entryCount], [66, 33], 'MISS T8: entry rows not run');
const rate = {num:25, den:1};
assert.throws(() => t.snapDecimalSeconds('source', '1', rate), /frame edge is required/, 'MISS T6: default edge accepted');
assert.equal(String(t.snapDecimalSeconds('source', '0.039999999999999999999', rate, 'end').frames), '0', 'MISS T9: decimal lost a digit');
console.log(`${cjs ? 'COMMONJS' : es ? 'EXTENDSCRIPT' : 'ES MODULE'} TABLE OK: ${legacyCount + entryCount} cases and available inverses (66 legacy + 33 entry)`);
