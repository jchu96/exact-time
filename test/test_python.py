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


def run_file(row):
    op, clock = row['op'], row['clock']
    if op == 'fromOtioFileTime':
        return t.fromOtioFileTime(clock, row['input'])
    position = t.fileTime(clock, row['count'], row['timescale'])
    if op == 'fileTime':
        return position
    if op == 'fileTimeToTicks':
        return t.fileTimeToTicks(position)
    if op == 'fileTimeToFrames':
        edges = [row['edge']] if 'edge' in row else []
        time = t.fileTimeToFrames(position, row['rate'], *edges)
        return dict(time, frames=str(time['frames']))
    assert op == 'toOtioFileTime'
    wire = t.toOtioFileTime(position)
    assert t.fromOtioFileTime(clock, wire) == dict(clock=clock, count=row['count'], timescale=row['timescale']), row['id']
    return wire


def run_otio(row):
    clock = row['clock']
    if row['op'] == 'toOtioFileTime':
        return run_file(row)
    if row['op'] == 'toOtioTime':
        wire = t.toOtioTime(t.exactTime(clock, row['frames'], row['rate']))
        explicit = [row['rate']] if row.get('explicit') else []
        restored = t.fromOtioTime(clock, wire, *explicit)
        assert restored == dict(clock=clock, frames=int(row['frames']), rate=row['rate'], unit='video-frame'), row['id']
        if row['rate']['den'] != 1:
            rounded = dict(wire, rate=round(wire['rate'], 3))
            try:
                t.fromOtioTime(clock, rounded, *explicit)
            except ValueError as error:
                assert error.code == 'INVALID_RATE', row['id']
            else:
                raise AssertionError(row['id'] + ' accepted rounded writer rate')
        return wire
    if row['op'] == 'toOtioRange':
        span = dict(start=t.exactTime(clock, row['frames'], row['rate']),
                    duration=t.exactTime(row['durationClock'], row['duration'], row['rate']))
        wire = t.toOtioRange(span)
        assert t.fromOtioRange(clock, wire) == span, row['id']
        return wire
    args = [row['rate']] if 'rate' in row else []
    if row['op'] == 'fromOtioTime':
        time = t.fromOtioTime(row['clock'], row['input'], *args)
        return dict(time, frames=str(time['frames']))
    assert row['op'] == 'fromOtioRange'
    result = t.fromOtioRange(row['clock'], row['input'], *args)
    return {key: dict(time, frames=str(time['frames'])) for key, time in result.items()}


def check_rows(rows, run_case):
    for row in rows:
        try:
            got = run_case(row)
        except ValueError as error:
            assert error.code == row['refused'], row['id']
        else:
            assert got == row['expected'], row['id']
    return len(rows)


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
    tick_count = check_rows(table['tickCases'], run_tick)
    otio_count = check_rows(table['otioCases'], run_otio)
    file_count = check_rows(table['fileClockCases'], run_file)
    assert tick_count == 8, 'tick rows run'
    assert otio_count == 32, 'OTIO rows run'
    assert file_count == 35, 'file-clock rows run'
    print(f'PYTHON TABLE OK: {legacy_count + entry_count + tick_count + otio_count + file_count} cases and available inverses '
          f'(66 legacy + 33 entry + {tick_count} tick + {otio_count} OTIO + {file_count} file-clock)')


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
