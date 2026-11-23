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
const panel = vm.runInNewContext(readFileSync(dist + 'exact-time.jsx', 'utf8') + '\nExactTime');
const rate = { num: 25, den: 1 };
const probes = [
  ['fromTicks', ['source', '1', rate], 'NOT_ON_FRAME_BOUNDARY'],
  ['fromContainingTicks', ['reel', '0', { num: 11, den: 1 }], 'UNREPRESENTABLE'],
  ['exactTime', ['reel', '01', rate], 'INVALID_INPUT'],
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
];

const python = JSON.parse(execFileSync('python3', ['-IB', '-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import exact_time
codes = []
for name, args, expected in json.load(sys.stdin):
    try:
        getattr(exact_time, name)(*args)
    except Exception as error:
        codes.append(getattr(error, 'code', None))
    else:
        codes.append('accepted')
print(json.dumps(dict(names=[n for n in dir(exact_time) if not n.startswith('_')], codes=codes)))
`, dist], { input: JSON.stringify(probes), encoding: 'utf8' }));

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

test('refusal codes match across CommonJS, ES modules, ES3 and Python', () => {
  for (const [i, [name, args, expected]] of probes.entries()) {
    for (const [form, api] of [['CommonJS', cjs], ['ES module', esm], ['ES3', panel]]) {
      expect(() => api[name](...args), form + ' ' + name).toThrow(expect.objectContaining({ code: expected }));
    }
    expect(python.codes[i], 'Python ' + name).toBe(expected);
  }
});
