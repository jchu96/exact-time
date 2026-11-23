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
// Keep the decimal spelling on the wire so Python actually receives floats.
const wholeRate = { num: JSON.rawJSON('25.0'), den: JSON.rawJSON('1.0') };
const wire = JSON.stringify([
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
codes = []
for name, args, expected in json.load(sys.stdin):
    try:
        if name == 'renderExactTimecode':
            args = [exact_time.exactTime(*args[0])]
        if name == 'mediaClockSchema.parse':
            exact_time.mediaClockSchema.parse(*args)
        else:
            getattr(exact_time, name)(*args)
    except Exception as error:
        codes.append(getattr(error, 'code', None))
    else:
        codes.append('accepted')
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
print(json.dumps(dict(names=[n for n in dir(exact_time) if not n.startswith('_')], codes=codes, clocks=clocks)))
`, dist], { input: wire, encoding: 'utf8' }));

// Existing Node-only serializers, approximate-time helpers and validators.
const nodeOnly = [
  'ACCEPTED_RATES', 'exactMilliseconds', 'fromBoundaryMilliseconds', 'modelTime',
  'offsetApproximate', 'rateError', 'rateSchema', 'renderApproximate',
  'timecodeSpecSchema', 'toOtioRange', 'toOtioTime',
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
  'MediaClock', 'SnappedTime', 'TimecodeSpec',
];

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
  const reason = 'Expected a source, reel or timeline clock; time of day is not a cut point.';
  const forms = 'Accepted forms: unsigned whole frames, ticks or milliseconds; HH:MM:SS:FF (non-drop) or HH:MM:SS;FF (drop), at a declared rate.';
  for (const [form, api] of [['CommonJS', cjs], ['ES module', esm], ['ES3', panel]]) {
    expect(Array.from(api.MEDIA_CLOCKS), form + ' MEDIA_CLOCKS').toEqual(python.clocks);
    expect(Object.isFrozen(api.MEDIA_CLOCKS), form).toBe(true);
    for (const clock of api.MEDIA_CLOCKS) {
      expect(api.mediaClockSchema.parse(clock)).toBe(clock);
      expect(api.exactTime(clock, '0', rate).clock).toBe(clock);
    }
    const message = form === 'ES3' ? reason : reason + ' ' + forms;
    for (const call of [() => api.mediaClockSchema.parse('day'), () => api.exactTime('day', '0', rate)]) {
      expect(call).toThrow(expect.objectContaining({ name: 'Error', code: 'INVALID_INPUT', message }));
    }
  }
});

test('ES3 callers cannot change clock validation by editing their snapshot', () => {
  const legacy = vm.runInNewContext('Object.freeze = undefined;\n' + panelScript);
  expect(Array.from(legacy.MEDIA_CLOCKS)).toEqual(python.clocks);
  legacy.MEDIA_CLOCKS[1] = 'day';
  expect(legacy.mediaClockSchema.parse('reel')).toBe('reel');
  expect(() => legacy.exactTime('day', '0', rate)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});

test.each(probes.map(([name, args, expected], i) => [name, args, expected, python.codes[i]]))(
  'refusal codes match for %s(%j) → %s', (name, args, expected, pythonCode) => {
    for (const [form, api] of [['CommonJS', cjs], ['ES module', esm], ['ES3', panel]]) {
      const callArgs = name === 'renderExactTimecode' ? [api.exactTime(...args[0])] : args;
      const parse = name === 'mediaClockSchema.parse' ? api.mediaClockSchema.parse : api[name];
      expect(() => parse(...callArgs), form + ' ' + name).toThrow(expect.objectContaining({ code: expected }));
    }
    expect(pythonCode, 'Python ' + name).toBe(expected);
  },
);
