"""Every public case plus available inverse paths; no private expected table."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
import exact_time as t

CONTRACT = ROOT / "contracts" / "time-cases.json"


def run(c):
    op, value = c['op'], c['input']
    if op == 'rate':
        return t.parseTimecodeRate(value)
    clock, rate, drop = c.get('clock'), c.get('rate'), c.get('dropFrame')
    if op == 'offset':
        time = t.offsetTime(t.exactTime('source', value, rate), t.exactTime(clock, c['offset'], rate))
    else:
        fn = {'frames': t.exactTime, 'milliseconds': t.fromMilliseconds, 'ticks': t.fromTicks, 'timecode': t.fromTimecode}[op]
        time = fn(clock, value, rate, drop) if op == 'timecode' else fn(clock, value, rate)
    return t.deriveExact(time, drop)


def run_entry(c):
    op, value, clock, rate = (c[key] for key in ('op', 'input', 'clock', 'rate'))
    if op == 'snapRange':
        start = t.snapDecimalSeconds(clock, value, rate, 'start')['frames']
        end = t.snapDecimalSeconds(clock, c['endInput'], rate, 'end')['frames']
        return dict(startFrame=str(start), endFrame=str(end), empty=start >= end)
    if op == 'toPremiereMilliseconds':
        ms = t.toPremiereMilliseconds(t.exactTime(clock, value, rate))
        if 'expected' in c:
            assert str(t.fromPremiereMilliseconds(clock, ms, rate)['frames']) == value
        return {'milliseconds': ms}
    if op == 'fromPremiereMilliseconds':
        result = t.fromPremiereMilliseconds(clock, value, rate)
        if 'expected' in c:
            assert t.toPremiereMilliseconds(result) == value, f"MISS inverse ms {c['id']}"
        return {'frames': str(result['frames'])}
    assert op == 'snapDecimalSeconds', op
    result = t.snapDecimalSeconds(clock, value, rate, c['edge'])
    return dict(frames=str(result['frames']), askedSeconds=result['askedSeconds'], edge=result['edge'],
                moved=result['moved'], movement={k: str(v) for k, v in result['movement'].items()})


def run_tick(row):
    if row['op'] == 'ticksAtGrid':
        return t.ticksAtGrid(row['frames'], row['grid'])
    assert row['op'] == 'fromContainingTicks'
    time = t.fromContainingTicks(row['clock'], row['ticks'], row.get('rate'))
    return dict(time, frames=str(time['frames']))


def run_table(override=None):
    canonical = CONTRACT.read_bytes()
    if override and Path(override).read_bytes() != canonical:
        raise ValueError("table differs from the repository contract")
    table = json.loads(canonical)
    cases = table['cases']
    legacy_count = entry_count = 0
    for c in cases:
        try:
            got = run(c)
        except ValueError as e:
            assert c.get('refused') and str(e).startswith(c['refused']), f"MISS {c['id']}: {e}"
        else:
            assert got == c.get('expected'), f"MISS {c['id']}: {got} != {c.get('expected', c.get('refused'))}"
            if 'frames' in got:
                for key, fn in [('ticks', t.fromTicks), ('timecode', t.fromTimecode)]:
                    if key in got:
                        args = [got['clock'], got[key], got['rate']]
                        if key == 'timecode': args.append(got['dropFrame'])
                        assert str(fn(*args)['frames']) == got['frames'], f'MISS inverse {c["id"]}'
        legacy_count += 1
    for c in table['entryCases']:
        try:
            got = run_entry(c)
        except ValueError as e:
            assert 'refused' in c and str(e).startswith(c['refused']), f"MISS {c['id']}: {e}"
            assert 'Accepted forms:' in str(e), f"MISS refusal guidance {c['id']}"
        else:
            assert got == c.get('expected'), f"MISS {c['id']}: {got}"
        entry_count += 1
    assert (legacy_count, entry_count) == (66, 33), 'MISS T8: entry rows not run'
    tick_count = 0
    for row in table['tickCases']:
        try:
            got = run_tick(row)
        except ValueError as error:
            assert error.code == row['refused'], row['id']
        else:
            assert got == row['expected'], row['id']
        tick_count += 1
    assert tick_count == 8, 'tick rows run'
    print(f'PYTHON TABLE OK: {legacy_count + entry_count + tick_count} cases and available inverses (66 legacy + 33 entry + {tick_count} tick)')


def main():
    override = sys.argv[1] if len(sys.argv) > 1 else None
    # A caller-supplied table cannot substitute for the repository contract.
    available = override or CONTRACT
    with TemporaryDirectory() as temp:
        missing = Path(temp) / "missing.json"
        with patch.object(sys.modules[__name__], 'CONTRACT', missing):
            try:
                run_table(available)
            except FileNotFoundError as error:
                if error.filename != str(missing):
                    raise
            else:
                raise AssertionError('MISS T12: repository contract unavailable')
    run_table(override)
    rate = dict(num=25, den=1)
    try:
        t.snapDecimalSeconds('source', '1', rate)
    except ValueError as error:
        assert str(error) == 'A frame edge is required. Accepted forms: start, end or instant.'
    else:
        raise AssertionError('MISS T6: default edge accepted')
    boundary = t.snapDecimalSeconds('source', '0.039999999999999999999', rate, 'end')
    assert boundary['frames'] == 0, 'MISS T9: decimal lost a digit'


if __name__ == '__main__':
    main()
