"""Run identical JSON inputs through all three release files, including whole-valued floats."""
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True  # Keep the release directory byte-for-byte intact.
sys.path.insert(0, str(ROOT / 'dist'))
import exact_time as time

SNAP = 'snapDecimalSeconds'
READ = 'fromPremiereMilliseconds'
WRITE = 'toPremiereMilliseconds'
AT25 = {'num': 25.0, 'den': 1.0}
FRACTIONAL = {'num': 25.5, 'den': 1}
FAST = {'num': 1001, 'den': 1}
LONG_MS = '1' + '0' * 4300


def video_frame(frames, rate):
    return {'clock': 'source', 'unit': 'video-frame', 'frames': frames, 'rate': rate}


# Python's JSON encoder retains 25.0 and 1.0 in the data sent to JavaScript.
# The last item is the expected frame, written millisecond, or refusal prefix.
PROBES = [
    ('fromMilliseconds', ['source', '1\u0661', {'num': 25, 'den': 1}], 'Expected a non-negative unpadded whole number.'),
    ('fromMilliseconds', ['source', LONG_MS], LONG_MS),
    (SNAP, ['source', '1.04', AT25, 'instant'], '26'),
    (READ, ['source', '40', AT25], '1'),
    (WRITE, [video_frame('1', AT25)], '40'),
    (SNAP, ['source', '0.039999999999999999999', AT25, 'end'], '0'),
    (WRITE, [video_frame('9007199254740993', AT25)], '360287970189639720'),
    (READ, ['source', '360287970189639720', AT25], '9007199254740993'),
    (READ, ['source', '41', AT25], 'No frame writes 41 ms.'),
    (READ, ['source', '0', FAST], 'Above 1000 fps'),
    (WRITE, [video_frame('1', FAST)], 'Above 1000 fps'),
    (SNAP, ['source', '1', AT25, None], 'A frame edge is required.'),
    (SNAP, ['source', '1', AT25], 'A frame edge is required.'),
    (SNAP, ['source', '1', FRACTIONAL, 'start'], 'Rate must contain positive safe whole numbers.'),
    (READ, ['source', '40', {'num': 25, 'den': 1.5}], 'Rate must contain positive safe whole numbers.'),
    (SNAP, ['source', '1', {'num': 9007199254740991.0, 'den': 9007199254740991.0}, 'end'], '1'),
    (READ, ['source', '0', {'num': 9007199254740992.0, 'den': 1}], 'Rate must contain positive safe whole numbers.'),
]


def execute_python(entry, args):
    if entry == WRITE:
        args = [dict(args[0], frames=int(args[0]['frames']))]
    try:
        result = getattr(time, entry)(*args)
    except ValueError as error:
        return {'refused': str(error)}
    if isinstance(result, dict):
        result = dict(result, frames=str(Decimal(result['frames'])))
        if 'movement' in result:
            result['movement'] = {key: str(value) for key, value in result['movement'].items()}
    return {'value': result}


class EntryParity(unittest.TestCase):
    def test_release_forms(self):
        # Send the original JSON to both runtimes so neither can normalize the other’s input.
        wire = json.dumps([[entry, args] for entry, args, _ in PROBES])
        output = subprocess.check_output(['node', str(ROOT / 'test/entry-parity.mjs')], input=wire, text=True)
        esm, es3 = json.loads(output)
        rows = json.loads(wire)
        for (entry, args), (_, _, expected), module, panel in zip(rows, PROBES, esm, es3, strict=True):
            with self.subTest(entry=entry, args=args):
                python = execute_python(entry, args)
                if entry == 'fromMilliseconds' and 'refused' in module:
                    # The legacy TS reader appends usage guidance to the common refusal reason.
                    for response in [module, panel, python]:
                        self.assertIn('refused', response)
                        self.assertEqual(response['refused'].partition(' Accepted forms:')[0], expected)
                    continue
                self.assertEqual(panel, module)
                self.assertEqual(python, module)
                if expected.isdigit():
                    value = module['value']
                    self.assertEqual(value if entry == WRITE else value['frames'], expected)
                else:
                    self.assertTrue(module['refused'].startswith(expected), module)

    def test_python_rate_boundaries(self):
        with self.assertRaisesRegex(ValueError, 'Rate must contain positive safe whole numbers'):
            time.exactTime('source', '1', AT25)
        for rate in [FRACTIONAL, {'num': True, 'den': 1}, {'num': 25, 'den': 0.0}]:
            with self.subTest(rate=rate), self.assertRaisesRegex(ValueError, 'Rate must contain positive safe whole numbers'):
                time.toPremiereMilliseconds(video_frame(1, rate))


if __name__ == '__main__':
    result = unittest.main(exit=False).result
    if not result.wasSuccessful():
        sys.exit(1)
    print(f'ENTRY PARITY OK: {len(PROBES)} probes matched across TypeScript, Python and ES3')
