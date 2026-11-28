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
function portableTime(time) {
  return {...time, frames:String(time.frames), rate:{...time.rate}};
}
function runTick(row) {
  if (row.op === 'ticksAtGrid') return t.ticksAtGrid(row.frames, row.grid);
  assert.equal(row.op, 'fromContainingTicks');
  const time = t.fromContainingTicks(row.clock, row.ticks, row.rate);
  return portableTime(time);
}
function runFile(row) {
  if (row.op === 'fromOtioFileTime') return {...t.fromOtioFileTime(row.clock, row.input)};
  const position = t.fileTime(row.clock, row.count, row.timescale);
  if (row.op === 'fileTime') return {...position};
  if (row.op === 'fileTimeToTicks') return t.fileTimeToTicks(position);
  if (row.op === 'fileTimeToFrames') return portableTime(t.fileTimeToFrames(position, row.rate, row.edge));
  assert.equal(row.op, 'toOtioFileTime');
  const wire = t.toOtioFileTime(position);
  assert.deepEqual({...t.fromOtioFileTime(row.clock, wire)}, {clock:row.clock, count:row.count, timescale:row.timescale}, row.id);
  return {...wire};
}
function runOtio(row) {
  if (row.op === 'toOtioFileTime') return runFile(row);
  if (row.op === 'toOtioTime') {
    const wire = t.toOtioTime(t.exactTime(row.clock, row.frames, row.rate));
    const read = sample => portableTime(t.fromOtioTime(row.clock, sample, row.explicit ? row.rate : undefined));
    assert.deepEqual(read(wire), {clock:row.clock, frames:row.frames, rate:row.rate, unit:'video-frame'}, row.id);
    if (row.rate.den !== 1) {
      const rounded = {...wire, rate:Number(wire.rate.toFixed(3))};
      assert.throws(() => read(rounded), {code:'INVALID_RATE'}, row.id + ' rounded writer rate');
    }
    return {...wire};
  }
  if (row.op === 'toOtioRange') {
    const start = t.exactTime(row.clock, row.frames, row.rate);
    const duration = t.exactTime(row.durationClock, row.duration, row.rate);
    const wire = t.toOtioRange({start, duration});
    const restored = t.fromOtioRange(row.clock, wire);
    assert.deepEqual(portableTime(restored.start), portableTime(start), row.id);
    assert.deepEqual(portableTime(restored.duration), portableTime(duration), row.id);
    return JSON.parse(JSON.stringify(wire));
  }
  if (row.op === 'fromOtioTime') return portableTime(t.fromOtioTime(row.clock, row.input, row.rate));
  assert.equal(row.op, 'fromOtioRange');
  const range = t.fromOtioRange(row.clock, row.input, row.rate);
  return {...range, start:portableTime(range.start), duration:portableTime(range.duration)};
}
function checkRows(rows, run) {
  for (const row of rows) {
    if (row.refused) assert.throws(() => run(row), {code:row.refused}, row.id);
    else assert.deepEqual(run(row), row.expected, row.id);
  }
  return rows.length;
}
const tickCount = checkRows(table.tickCases, runTick);
const otioCount = checkRows(table.otioCases, runOtio);
const fileCount = checkRows(table.fileClockCases, runFile);
assert.equal(tickCount, 8, 'tick rows run');
assert.equal(otioCount, 32, 'OTIO rows run');
assert.equal(fileCount, 33, 'file-clock rows run');
const rate = {num:25, den:1};
assert.throws(() => t.snapDecimalSeconds('source', '1', rate), /frame edge is required/, 'MISS T6: default edge accepted');
assert.equal(String(t.snapDecimalSeconds('source', '0.039999999999999999999', rate, 'end').frames), '0', 'MISS T9: decimal lost a digit');
console.log(`${cjs ? 'COMMONJS' : es ? 'EXTENDSCRIPT' : 'ES MODULE'} TABLE OK: ${legacyCount + entryCount + tickCount + otioCount + fileCount} cases and available inverses (66 legacy + 33 entry + ${tickCount} tick + ${otioCount} OTIO + ${fileCount} file-clock)`);
