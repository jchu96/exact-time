import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test } from 'vitest';
import * as esm from '../dist/exact-time.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const cjs = createRequire(import.meta.url)('../dist/exact-time.cjs');
const panelScript = readFileSync(dist + 'exact-time.jsx', 'utf8') + '\nExactTime';
const panel = vm.runInNewContext(panelScript);
const rate = { num: 25, den: 1 };
const clockRefusal = 'Expected a source, reel or timeline clock; time of day is not a cut point.';
// Keep the decimal spelling on the wire so Python actually receives floats.
const wholeRate = { num: JSON.rawJSON('25.0'), den: JSON.rawJSON('1.0') };
const otioTime = (value, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate });
const otioRange = (start_time, duration) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time, duration });
// A JSON exponent outside binary64's range reaches each reader as infinity.
const overflow = JSON.rawJSON('1e400');
const nextDoubleAboveFilmRate = 23.97602397602398;
const { fileClockCases } = JSON.parse(readFileSync(new URL('../contracts/time-cases.json', import.meta.url), 'utf8'));
const fileRefusals = fileClockCases.filter(row => row.refused).map(row => {
  const position = { clock: row.clock, count: row.count, timescale: row.timescale };
  let args = [position];
  if (row.op === 'fileTime') args = [row.clock, row.count, row.timescale];
  if (row.op === 'fromOtioFileTime') args = [row.clock, row.input];
  if (row.op === 'fileTimeToFrames') args = row.edge === undefined ? [position, row.rate] : [position, row.rate, row.edge];
  return [row.op, args, row.refused];
});
const wire = JSON.stringify([
  ...fileRefusals,
  ...[23.976, 23.98, 29.97, 59.94, nextDoubleAboveFilmRate, 0, -24, 14.985014985014985, 9007199254740992, overflow, '24', true].map(rate =>
    ['fromOtioTime', ['source', otioTime(0, rate)], 'INVALID_RATE']),
  ...[-8631368.631368631, 0.5, -1, overflow, '1', true].map(value =>
    ['fromOtioTime', ['source', otioTime(value, 24000 / 1001)], 'INVALID_INPUT']),
  ...[null, { num: 0, den: 1 }, { num: 24, den: 0 }, { num: 24.5, den: 1 },
    { num: 9007199254740992, den: 1 }, { num: 25, den: 1 }].map(explicitRate =>
    ['fromOtioTime', ['source', otioTime(0, 24), explicitRate], 'INVALID_RATE']),
  ['fromOtioTime', ['source', otioTime(0, nextDoubleAboveFilmRate), { num: 24000, den: 1001 }], 'INVALID_RATE'],
  ['fromOtioTime', ['source', otioTime(0, true), { num: 1, den: 1 }], 'INVALID_RATE'],
  ['fromOtioRange', ['reel', otioRange(otioTime(0, 24), otioTime(96, 25)), { num: 24, den: 1 }], 'INVALID_RATE'],
  ['fromOtioTime', ['source', otioTime(9007199254740992, 24)], 'UNREPRESENTABLE'],
  ['toOtioTime', [['source', '9007199254740992', rate]], 'UNREPRESENTABLE'],
  ['toOtioRange', [['source', '0', rate], ['reel', '1', rate]], 'INVALID_INPUT'],
  ['fromOtioTime', ['source', { value: 0, rate: 24 }], 'INVALID_INPUT'],
  ['fromOtioTime', ['source', { ...otioTime(0, 24), OTIO_SCHEMA: 'RationalTime.2' }], 'INVALID_INPUT'],
  ['fromOtioTime', ['day', otioTime(0, 24)], 'INVALID_INPUT'],
  ['fromOtioRange', ['source', otioTime(0, 24)], 'INVALID_INPUT'],
  ['fromOtioRange', ['source', {}], 'INVALID_INPUT'],
  ['fromOtioRange', ['source', otioRange(otioTime(0, 24), null)], 'INVALID_INPUT'],
  ['fromOtioRange', ['source', otioRange(otioTime(0, 24), otioTime(0, 25))], 'INVALID_RATE'],
  ['fromOtioRange', ['source', otioRange(otioTime(0, 24), otioTime(-1, 24))], 'INVALID_INPUT'],
  ['fromTicks', ['source', '1', rate], 'NOT_ON_FRAME_BOUNDARY'],
  ['fromTicks', ['reel', '10160640001', wholeRate], 'NOT_ON_FRAME_BOUNDARY'],
  ['fromTicks', ['reel', '10160640000', { num: 25.5, den: 1 }], 'INVALID_RATE'],
  ['renderExactTimecode', [['source', '1', rate]], 'INVALID_TIMECODE'],
  ['fromContainingTicks', ['reel', '0', { num: 11, den: 1 }], 'UNREPRESENTABLE'],
  ['exactTime', ['reel', '01', rate], 'INVALID_INPUT'],
  ['mediaClockSchema.parse', ['day'], 'INVALID_INPUT'],
  ['mediaClockSchema.parse', [null], 'INVALID_INPUT'],
  ['mediaClockSchema.parse', ['Reel'], 'INVALID_INPUT'],
  ['ticksAtGrid', ['1', '0'], 'INVALID_INPUT'],
  ['snapDecimalSeconds', ['reel', '1', rate, 'nearest'], 'INVALID_INPUT'],
  ['snapDecimalSeconds', ['day', '1', rate, 'instant'], 'INVALID_INPUT'],
  ['fromPremiereMilliseconds', ['source', '41', rate], 'UNREPRESENTABLE'],
  ['fromPremiereMilliseconds', ['source', '0', { num: 0, den: 1 }], 'INVALID_RATE'],
  ['parseTimecodeRate', ['29.97'], 'INVALID_RATE'],
  ['rationalRate', [0, 1], 'INVALID_RATE'],
  ['isDropRate', [null], 'INVALID_RATE'],
  ['exactTime', ['source', '0', null], 'INVALID_RATE'],
  ['parseTimecodeRate', [null], 'INVALID_RATE'],
  ['fromTimecode', ['source', null, rate, false], 'INVALID_TIMECODE'],
  ['fromTimecode', ['source', '00:00:00:25', rate, false], 'INVALID_TIMECODE'],
]);
const probes = JSON.parse(wire);

const python = JSON.parse(execFileSync('python3', ['-IB', '-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import exact_time
refusals = []
for name, args, expected in json.load(sys.stdin):
    try:
        if name in ('renderExactTimecode', 'toOtioTime'):
            args = [exact_time.exactTime(*args[0])]
        if name == 'toOtioRange':
            args = [dict(start=exact_time.exactTime(*args[0]), duration=exact_time.exactTime(*args[1]))]
        if name == 'mediaClockSchema.parse':
            exact_time.mediaClockSchema.parse(*args)
        else:
            getattr(exact_time, name)(*args)
    except Exception as error:
        refusals.append(dict(code=getattr(error, 'code', None), message=str(error)))
    else:
        refusals.append(None)
clocks = exact_time.MEDIA_CLOCKS
assert isinstance(clocks, tuple)
for clock in clocks:
    assert exact_time.mediaClockSchema.parse(clock) == clock
    assert exact_time.exactTime(clock, '0', {'num': 25, 'den': 1})['clock'] == clock
# Narrow the rule in this isolated process to detect a private copy in either caller.
exact_time.MEDIA_CLOCKS = tuple(c for c in clocks if c != 'reel')
for parse in (exact_time.mediaClockSchema.parse, lambda c: exact_time.exactTime(c, '0', {'num': 25, 'den': 1})):
    try:
        parse('reel')
    except ValueError as error:
        assert error.code == 'INVALID_INPUT'
        assert str(error) == 'Expected a source, reel or timeline clock; time of day is not a cut point.'
    else:
        raise AssertionError('reel was accepted after removal from MEDIA_CLOCKS')
print(json.dumps(dict(names=[n for n in dir(exact_time) if not n.startswith('_')], refusals=refusals, clocks=clocks)))
`, dist], { input: wire, encoding: 'utf8' }));

// Existing Node-only serializers, approximate-time helpers and validators.
const nodeOnly = [
  'ACCEPTED_RATES', 'exactMilliseconds', 'fromBoundaryMilliseconds', 'modelTime',
  'offsetApproximate', 'rateError', 'rateSchema', 'renderApproximate',
  'timecodeSpecSchema',
];
// Existing Python adapters, implementation helpers and unprefixed standard-library imports.
const pythonOnly = [
  'Decimal', 'Fraction', 'clock_fraction', 'clock_seconds', 'frame_seconds', 'frame_ticks',
  'frames_from_grid', 'infer_nominal_rate', 'makeTime', 'math', 'natural', 'nominalRate', 'rate',
  're', 'relative_frame_seconds', 'seconds_difference', 'seconds_display', 'seconds_frames',
  'seconds_ticks', 'subtitle', 'ticksPerFrame', 'ticks_seconds', 'timecode', 'timecode_frames', 'xml_rate',
];
// These exports exist only in the TypeScript declarations.
const typesOnly = [
  'ApproximateTime', 'DecimalFrameTime', 'ExactRange', 'ExactTime', 'FrameEdge', 'FrameRate',
  'FileTime', 'MediaClock', 'SnappedTime', 'TimecodeSpec',
];

test('OTIO times and ranges round trip through every reader at ten named rates, 120/1 and explicit 15000/1001', () => {
  const rates = [
    ...[24, 25, 30, 48, 50, 60, 120].map(num => ({ num, den: 1 })),
    ...[24000, 48000, 30000, 60000].map(num => ({ num, den: 1001 })),
    { num: 15000, den: 1001 },
  ];
  const samples = rates.map(rate => {
    const start = esm.exactTime('reel', '86472', rate);
    const duration = esm.exactTime('reel', '96', rate);
    const args = rate.num === 15000 ? [rate] : [];
    return [rate, args, esm.toOtioTime(start), esm.toOtioRange({ start, duration })];
  });
  for (const [rate, args, time, range] of samples) {
    for (const api of [esm, cjs, panel]) {
      const start = api.exactTime('reel', '86472', rate);
      const duration = api.exactTime('reel', '96', rate);
      expect(api.toOtioTime(start)).toEqual(time);
      expect(api.toOtioRange({ start, duration })).toEqual(range);
      expect(api.fromOtioTime('reel', time, ...args)).toEqual(start);
      expect(api.fromOtioRange('reel', range, ...args)).toEqual({ start, duration });
    }
  }
  execFileSync('python3', ['-IB', '-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import exact_time as t
for rate, args, time, span in json.load(sys.stdin):
    start = t.exactTime('reel', '86472', rate)
    duration = t.exactTime('reel', '96', rate)
    assert t.toOtioTime(start) == time, rate
    assert t.toOtioRange(dict(start=start, duration=duration)) == span, rate
    assert t.fromOtioTime('reel', time, *args) == start, rate
    assert t.fromOtioRange('reel', span, *args) == dict(start=start, duration=duration), rate
`, dist], { input: JSON.stringify(samples) });
});

test('release exports match across CommonJS, ES modules, ES3 and Python', () => {
  const common = Object.keys(panel);
  for (const [form, actual, extra] of [
    ['CommonJS', Object.keys(cjs), nodeOnly], ['ES module', Object.keys(esm), nodeOnly],
    ['Python', python.names, pythonOnly],
  ]) {
    expect(actual.sort(), form).toEqual([...common, ...extra].sort());
  }
  const paths = ['exact-time.d.cts', 'exact-time.d.mts'].map(name => dist + name);
  const program = ts.createProgram(paths, { noEmit: true, types: [] });
  const checker = program.getTypeChecker();
  for (const path of paths) {
    const symbol = checker.getSymbolAtLocation(program.getSourceFile(path));
    const names = checker.getExportsOfModule(symbol).map(exp => exp.name);
    expect(names.sort(), path).toEqual([...common, ...nodeOnly, ...typesOnly].sort());
  }
});

test('release clock lists and their validators agree', () => {
  expect(python.clocks).toEqual(['source', 'reel', 'timeline']);
  const forms = 'Accepted forms: unsigned whole frames, ticks or milliseconds; HH:MM:SS:FF (non-drop) or HH:MM:SS;FF (drop), at a declared rate.';
  for (const [form, api] of [['CommonJS', cjs], ['ES module', esm], ['ES3', panel]]) {
    expect(Array.from(api.MEDIA_CLOCKS), form + ' MEDIA_CLOCKS').toEqual(python.clocks);
    expect(Object.isFrozen(api.MEDIA_CLOCKS), form).toBe(true);
    for (const clock of api.MEDIA_CLOCKS) {
      expect(api.mediaClockSchema.parse(clock)).toBe(clock);
      expect(api.exactTime(clock, '0', rate).clock).toBe(clock);
    }
    const message = form === 'ES3' ? clockRefusal : clockRefusal + ' ' + forms;
    expect(() => api.exactTime('day', '0', rate)).toThrow(expect.objectContaining({
      name: 'Error', code: 'INVALID_INPUT', message,
    }));
  }
});

test('ES3 callers cannot change clock validation by editing their snapshot', () => {
  const legacy = vm.runInNewContext('Object.freeze = undefined;\n' + panelScript);
  expect(Array.from(legacy.MEDIA_CLOCKS)).toEqual(python.clocks);
  legacy.MEDIA_CLOCKS[1] = 'day';
  expect(legacy.MEDIA_CLOCKS[1]).toBe('day');
  expect(legacy.mediaClockSchema.parse('reel')).toBe('reel');
  expect(legacy.exactTime('reel', '0', rate).clock).toBe('reel');
  expect(() => legacy.mediaClockSchema.parse('day')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() => legacy.exactTime('day', '0', rate)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});

test.each(probes.map(([name, args, expected], i) => [name, args, expected, python.refusals[i]]))(
  'refusals match for %s(%j) → %s', (name, args, expected, pythonRefusal) => {
    const refusal = name === 'mediaClockSchema.parse' ? { code: expected, message: clockRefusal } : { code: expected };
    for (const [form, api] of [['CommonJS', cjs], ['ES module', esm], ['ES3', panel]]) {
      let callArgs = args;
      if (name === 'renderExactTimecode' || name === 'toOtioTime') callArgs = [api.exactTime(...args[0])];
      if (name === 'toOtioRange') callArgs = [{ start: api.exactTime(...args[0]), duration: api.exactTime(...args[1]) }];
      const parse = name === 'mediaClockSchema.parse' ? api.mediaClockSchema.parse : api[name];
      expect(() => parse(...callArgs), form + ' ' + name).toThrow(expect.objectContaining(refusal));
    }
    expect(pythonRefusal, 'Python ' + name).toMatchObject(refusal);
  },
);
