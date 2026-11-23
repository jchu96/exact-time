"""Python implementation of the pinned public exact-time contract.

All exact quantities use integers. Decimal seconds at consumer boundaries are
instants (half-open containment), never reconstructed from a reading display.
"""
from decimal import Decimal
from fractions import Fraction
import math
import re

TICKS_PER_SECOND = 254016000000


def natural(value):
    if not isinstance(value, str) or not re.fullmatch(r'0|[1-9]\d*', value):
        raise ValueError('Expected a non-negative unpadded whole number.')
    return int(value)


def rationalRate(num, den):
    if any(isinstance(v, bool) or not isinstance(v, int) or not 0 < v <= 9007199254740991 for v in (num, den)):
        raise ValueError('Rate must contain positive safe whole numbers.')
    f = Fraction(num, den)
    return {'num': f.numerator, 'den': f.denominator}


def isDropRate(rate):
    return Fraction(rate['num'], rate['den']) in (Fraction(30000, 1001), Fraction(60000, 1001))


def parseTimecodeRate(value):
    fail = 'Unsupported or ambiguous timecode rate.'
    m = re.fullmatch(r'(.*?)(?::?(ndf|df))?', value)
    if not m:
        raise ValueError(fail)
    name, choice = m.groups()
    aliases = {'23.976': (24000, 1001), '47.952': (48000, 1001),
               '29.97': (30000, 1001), '59.94': (60000, 1001)}
    try:
        if name in aliases:
            rate = rationalRate(*aliases[name])
        elif name in ('24', '25', '30', '48', '50', '60'):
            rate = rationalRate(int(name), 1)
        elif re.fullmatch(r'[1-9]\d*/[1-9]\d*', name):
            rate = rationalRate(*map(int, name.split('/')))
        else:
            raise ValueError(fail)
        if (isDropRate(rate) and not choice) or (choice == 'df' and not isDropRate(rate)):
            raise ValueError(fail)
    except ValueError:
        raise ValueError(fail) from None
    return {'rate': rate, 'dropFrame': choice == 'df', 'rateOrigin': 'declared'}


def makeTime(clock, frames, rate, unit):
    if clock not in ('source', 'reel', 'timeline'):
        raise ValueError('Expected a source, reel or timeline clock; time of day is not a cut point.')
    return {'clock': clock, 'frames': frames, 'rate': rate, 'unit': unit}


def exactTime(clock, frames, rate):
    return makeTime(clock, natural(frames), rationalRate(rate['num'], rate['den']), 'video-frame')


def fromMilliseconds(clock, ms, rate=None):
    value = natural(ms)
    if rate is None:
        return makeTime(clock, value, {'num': 1000, 'den': 1}, 'millisecond')
    rate = rationalRate(rate['num'], rate['den'])
    return makeTime(clock, value * rate['num'] // (1000 * rate['den']), rate, 'video-frame')


def _entry_refused(reason):
    raise ValueError(f'{reason} Accepted forms: unsigned whole frames, ticks or milliseconds; HH:MM:SS:FF (non-drop) or HH:MM:SS;FF (drop), at a declared rate.')


def _entry_rate(rate):
    # JSON has a single number type. Keep whole-valued rates in integer arithmetic.
    def component(value):
        return int(value) if isinstance(value, float) and value.is_integer() else value

    try:
        return rationalRate(component(rate['num']), component(rate['den']))
    except (TypeError, KeyError, ValueError):
        _entry_refused('Rate must contain positive safe whole numbers.')


def _entry_frame(clock, frames, rate):
    try:
        return makeTime(clock, frames, rate, 'video-frame')
    except ValueError as error:
        _entry_refused(str(error))


def snapDecimalSeconds(clock, seconds, rate, edge=None):
    if edge not in ('start', 'end', 'instant'):
        raise ValueError('A frame edge is required. Accepted forms: start, end or instant.')
    if not isinstance(seconds, str) or not re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?', seconds):
        raise ValueError('Expected decimal seconds as text. Accepted forms: an unsigned unpadded whole number with an optional fraction, such as 0 or 5.010.')
    rate = _entry_rate(rate)
    asked = Fraction(Decimal(seconds))
    fps = Fraction(rate['num'], rate['den'])
    position = asked * fps
    frame = math.ceil(position) if edge == 'start' else math.floor(position)
    movement = frame / fps - asked
    time = _entry_frame(clock, frame, rate)
    return dict(time, askedSeconds=seconds, edge=edge, moved=bool(movement),
                movement={'numerator': movement.numerator, 'denominator': movement.denominator})


def _premiere_scale(rate):
    scale = 1000 * rate['den']
    if rate['num'] > scale:
        _entry_refused('Above 1000 fps two frames can share one whole millisecond. Use a declared video rate of at most 1000 fps.')
    return scale


def fromPremiereMilliseconds(clock, ms, rate):
    if not isinstance(ms, str):
        _entry_refused('Expected whole milliseconds as text.')
    if not re.fullmatch(r'0|[1-9][0-9]*', ms):
        _entry_refused('Expected a non-negative unpadded whole number.')
    value = int(Decimal(ms))
    rate = _entry_rate(rate)
    scale = _premiere_scale(rate)
    frame = (value * rate['num'] + scale - 1) // scale
    if frame * scale >= (value + 1) * rate['num']:
        _entry_refused(f'No frame writes {ms} ms. It falls between the values written by frames {Decimal(frame - 1)} and {Decimal(frame)}.')
    return _entry_frame(clock, frame, rate)


def toPremiereMilliseconds(time):
    if not isinstance(time, dict) or time.get('unit') != 'video-frame':
        _entry_refused('Premiere milliseconds require an exact video frame at a declared video rate.')
    rate = _entry_rate(time.get('rate'))
    return str(Decimal(time['frames'] * _premiere_scale(rate) // rate['num']))


def nominalRate(time, dropFrame):
    if time['unit'] != 'video-frame':
        raise ValueError('Timecode requires a declared video rate.')
    if not isinstance(dropFrame, bool):
        raise ValueError('Drop-frame must be stated.')
    if dropFrame and not isDropRate(time['rate']):
        raise ValueError('Drop-frame requires 30000/1001 or 60000/1001.')
    r = time['rate']
    return (r['num'] + r['den'] - 1) // r['den']


def renderExactTimecode(time, dropFrame):
    nominal = nominalRate(time, dropFrame)
    frame = time['frames']
    if dropFrame:
        drop = 4 if nominal == 60 else 2
        ten = nominal * 600 - drop * 9
        minute = nominal * 60 - drop
        remainder = frame % ten
        frame += drop * 9 * (frame // ten) + (drop * ((remainder - drop) // minute) if remainder >= drop else 0)
    seconds, ff = divmod(frame, nominal)
    return f'{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02}{";" if dropFrame else ":"}{ff:02}'


def fromTimecode(clock, value, rate, dropFrame):
    zero = exactTime(clock, '0', rate)
    nominal = nominalRate(zero, dropFrame)
    m = re.fullmatch(r'(\d{2}|[1-9]\d{2,}):([0-5]\d):([0-5]\d)([:;])(\d{2}|[1-9]\d{2,})', value)
    if not m:
        raise ValueError('Malformed timecode.')
    if m[4] != (';' if dropFrame else ':'):
        raise ValueError('Timecode separator must match the stated drop-frame choice.')
    h, mi, s, ff = (int(m[i]) for i in (1, 2, 3, 5))
    if ff >= nominal:
        raise ValueError('Frame field must be below the nominal rate.')
    drop = (4 if nominal == 60 else 2) if dropFrame else 0
    if dropFrame and mi % 10 and s == 0 and ff < drop:
        raise ValueError('Drop-frame label does not exist.')
    minutes = h * 60 + mi
    return exactTime(clock, str((minutes * 60 + s) * nominal + ff - drop * (minutes - minutes // 10)), rate)


def ticksPerFrame(time):
    value, remainder = divmod(TICKS_PER_SECOND * time['rate']['den'], time['rate']['num'])
    return None if remainder else value


def fromTicks(clock, ticks, rate=None):
    value = natural(ticks)
    zero = exactTime(clock, '0', rate) if rate else fromMilliseconds(clock, '0')
    step = ticksPerFrame(zero)
    if step is None:
        raise ValueError('Ticks per frame are not whole at this rate.')
    if value % step:
        raise ValueError('Ticks must identify an exact frame boundary.')
    return makeTime(clock, value // step, zero['rate'], zero['unit'])


def deriveExact(time, dropFrame=None):
    f, r = time['frames'], time['rate']
    ms = (f * 1000 * r['den'] + r['num'] - 1) // r['num']
    out = {'clock': time['clock'], 'secondsDerived': True}
    if ms * r['num'] >= (f + 1) * 1000 * r['den']:
        out['secondsUnavailable'] = 'No whole millisecond falls inside this frame; three-decimal derived seconds are unavailable.'
    else:
        out['seconds'] = f'{ms // 1000}.{ms % 1000:03}'
    step = ticksPerFrame(time)
    if step is None:
        out['ticksUnavailable'] = 'Ticks per frame are not whole at this rate.'
    else:
        out['ticks'] = str(f * step)
    if time['unit'] == 'millisecond':
        out.update(milliseconds=str(f), rateBasis='whole-millisecond source; no declared video rate')
    else:
        out.update(frames=str(f), rate=r, timecode=renderExactTimecode(time, dropFrame), dropFrame=dropFrame)
    return out


def exactSeconds(time):
    result = deriveExact(time, False)
    if 'seconds' not in result:
        raise ValueError(result['secondsUnavailable'])
    return result['seconds']


def offsetTime(time, offset):
    if time['rate'] != offset['rate'] or time['unit'] != offset['unit']:
        raise ValueError('Exact offsets require the same rate and unit.')
    return makeTime(offset['clock'], time['frames'] + offset['frames'], offset['rate'], offset['unit'])


# Boundary adapters used by the existing tools. They do not choose a video rate
# for an audio clock, or a drop-frame policy from a fractional number alone.
def rate(value):
    if isinstance(value, dict):
        return rationalRate(value.get('num', value.get('numerator')), value.get('den', value.get('denominator')))
    if isinstance(value, float) and value == round(value * 1001) / 1001:
        return rationalRate(round(value * 1001), 1001)
    text = str(value)
    aliases = {'23.976': (24000, 1001), '29.97': (30000, 1001), '47.952': (48000, 1001), '59.94': (60000, 1001)}
    f = Fraction(*aliases[text]) if text in aliases else Fraction(text)
    return rationalRate(f.numerator, f.denominator)


def seconds_frames(seconds, fps, offset=0):
    r = rate(fps)
    s = Fraction(str(seconds)) + Fraction(str(offset))
    if s < 0:
        raise ValueError('Negative instant.')
    return (s * Fraction(r['num'], r['den'])).__floor__()


def frame_seconds(frame, fps):
    r = rate(fps)
    return float(Fraction(frame * r['den'], r['num']))


def timecode(frame, fps, drop=False):
    # Legacy callers sometimes hold an already integral frame as a float.
    if isinstance(frame, float) and frame.is_integer():
        frame = int(frame)
    return renderExactTimecode(exactTime('timeline', str(frame), rate(fps)), drop)


def timecode_frames(value, fps, drop=False):
    return fromTimecode('timeline', value, rate(fps), drop)['frames']


def ticks_seconds(ticks):
    return Fraction(int(ticks), TICKS_PER_SECOND)


def subtitle(seconds):
    ms = math.ceil(Fraction(str(seconds)) * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def clock_fraction(value):
    text = str(value).replace(',', '.')
    if ':' not in text:
        result = Fraction(text)
    else:
        parts = text.split(':')
        if len(parts) == 2:
            parts.insert(0, '00')
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            raise ValueError('Expected HH:MM:SS(.mmm).')
        h, m = map(int, parts[:2]); sec = Fraction(parts[2])
        if not 0 <= m < 60 or not 0 <= sec < 60:
            raise ValueError('Clock field out of range.')
        result = h * 3600 + m * 60 + sec
    if result < 0:
        raise ValueError('Negative clock.')
    return result


def clock_seconds(value):
    return float(clock_fraction(value))


def seconds_ticks(value):
    result = Fraction(str(value)) * TICKS_PER_SECOND
    if result.denominator != 1:
        raise ValueError('Seconds are not an exact tick boundary.')
    return result.numerator


def frame_ticks(frame, grid):
    return natural(str(frame)) * natural(str(grid))


def frames_from_grid(ticks, grid):
    value, step = natural(str(ticks)), natural(str(grid))
    if not step or value % step:
        raise ValueError('Ticks must identify an exact frame boundary.')
    return value // step


def xml_rate(node):
    nominal = int(node.findtext('rate/timebase'))
    return Fraction(nominal * 1000, 1001) if node.findtext('rate/ntsc') == 'TRUE' else Fraction(nominal, 1)


def seconds_display(seconds):
    ms = math.ceil(Fraction(str(seconds)) * 1000)
    return ms / 1000


def relative_frame_seconds(frame, origin, fps):
    r = rate(fps)
    return seconds_display(Fraction((frame-origin)*r['den'], r['num']))


def seconds_difference(end, start):
    return Fraction(str(end)) - Fraction(str(start))


def infer_nominal_rate(text):
    """Legacy subtitle metadata heuristic; not evidence of an exact media rate."""
    fields = [int(x) for x in re.findall(r'\d{1,2}:\d{2}:\d{2}:(\d{2})', text)]
    maximum = max(fields) if fields else 0
    guess = {23: 24, 24: 25, 29: 30, 25: 'odd', 59: 60}.get(maximum) if len(fields) >= 30 else None
    return guess, len(fields), maximum
