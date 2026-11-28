"""Python implementation of the pinned public exact-time contract.

All exact quantities use integers. Decimal seconds at consumer boundaries are
instants (half-open containment), never reconstructed from a reading display.
"""
from decimal import Decimal
from fractions import Fraction
from functools import wraps as _wraps
import math
import re

TICKS_PER_SECOND = 254016000000
MEDIA_CLOCKS = ('source', 'reel', 'timeline')


def _refusal(code, message):
    error = ValueError(message)
    error.code = code
    return error


def _classify(code):
    """Keep native parser exceptions and their messages when an adapter rejects input."""
    def decorate(parse):
        @_wraps(parse)
        def classified(*args, **kwargs):
            try:
                return parse(*args, **kwargs)
            except (ValueError, TypeError, KeyError, ArithmeticError) as error:
                if not hasattr(error, 'code'):
                    error.code = code
                raise
        return classified
    return decorate


def natural(value):
    if not isinstance(value, str) or not re.fullmatch(r'0|[1-9][0-9]*', value):
        raise _refusal('INVALID_INPUT', 'Expected a non-negative unpadded whole number.')
    return int(Decimal(value))


def _whole_number(value):
    # JSON numbers such as 25.0 denote whole components; keep frame arithmetic integral.
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _rate_components(rate):
    return _whole_number(rate['num']), _whole_number(rate['den'])


def rationalRate(num, den):
    num, den = _whole_number(num), _whole_number(den)
    if any(isinstance(v, bool) or not isinstance(v, int) or not 0 < v <= 9007199254740991 for v in (num, den)):
        raise _refusal('INVALID_RATE', 'Rate must contain positive safe whole numbers.')
    f = Fraction(num, den)
    return {'num': f.numerator, 'den': f.denominator}


@_classify('INVALID_RATE')
def isDropRate(rate):
    return Fraction(*_rate_components(rate)) in (Fraction(30000, 1001), Fraction(60000, 1001))


@_classify('INVALID_RATE')
def parseTimecodeRate(value):
    fail = 'Unsupported or ambiguous timecode rate.'
    m = re.fullmatch(r'(.*?)(?::?(ndf|df))?', value)
    if not m:
        raise _refusal('INVALID_RATE', fail)
    name, choice = m.groups()
    aliases = {'23.976': (24000, 1001), '47.952': (48000, 1001),
               '29.97': (30000, 1001), '59.94': (60000, 1001)}
    try:
        if name in aliases:
            rate = rationalRate(*aliases[name])
        elif name in ('24', '25', '30', '48', '50', '60'):
            rate = rationalRate(int(name), 1)
        elif re.fullmatch(r'[1-9][0-9]*/[1-9][0-9]*', name):
            rate = rationalRate(*map(int, name.split('/')))
        else:
            rate = None
    except ValueError:
        raise _refusal('INVALID_RATE', fail) from None
    if not rate or (isDropRate(rate) and not choice) or (choice == 'df' and not isDropRate(rate)):
        raise _refusal('INVALID_RATE', fail)
    return {'rate': rate, 'dropFrame': choice == 'df', 'rateOrigin': 'declared'}


class _MediaClockSchema:
    @staticmethod
    def parse(value):
        if value not in MEDIA_CLOCKS:
            raise _refusal('INVALID_INPUT', 'Expected a source, reel or timeline clock; time of day is not a cut point.')
        return value


mediaClockSchema = _MediaClockSchema()


def makeTime(clock, frames, rate, unit):
    mediaClockSchema.parse(clock)
    return {'clock': clock, 'frames': frames, 'rate': rate, 'unit': unit}


@_classify('INVALID_RATE')
def _normalized_rate(rate):
    return rationalRate(rate['num'], rate['den'])


def exactTime(clock, frames, rate):
    return makeTime(clock, natural(frames), _normalized_rate(rate), 'video-frame')


def fromMilliseconds(clock, ms, rate=None):
    value = natural(ms)
    if rate is None:
        return makeTime(clock, value, {'num': 1000, 'den': 1}, 'millisecond')
    rate = _normalized_rate(rate)
    return makeTime(clock, value * rate['num'] // (1000 * rate['den']), rate, 'video-frame')


def _entry_refused(code, reason):
    raise _refusal(code, f'{reason} Accepted forms: unsigned whole frames, ticks or milliseconds; HH:MM:SS:FF (non-drop) or HH:MM:SS;FF (drop), at a declared rate.')


def _entry_rate(rate):
    try:
        return _normalized_rate(rate)
    except (TypeError, KeyError, ValueError):
        _entry_refused('INVALID_RATE', 'Rate must contain positive safe whole numbers.')


def _entry_frame(clock, frames, rate):
    try:
        return makeTime(clock, frames, rate, 'video-frame')
    except ValueError as error:
        _entry_refused(error.code, str(error))


_NO_OTIO_RATE = object()


def toOtioTime(time):
    if time['frames'] > 9007199254740991:
        _entry_refused('UNREPRESENTABLE', 'OTIO value exceeds the safe whole-frame range.')
    rate = time['rate']
    return {'OTIO_SCHEMA': 'RationalTime.1', 'value': time['frames'], 'rate': rate['num'] / rate['den']}


def toOtioRange(span):
    if span['start']['clock'] != span['duration']['clock']:
        _entry_refused('INVALID_INPUT', 'A range start and duration must name the same clock.')
    return {'OTIO_SCHEMA': 'TimeRange.1', 'start_time': toOtioTime(span['start']),
            'duration': toOtioTime(span['duration'])}


def _file_parts(position):
    mediaClockSchema.parse(position['clock'])
    count, timescale = natural(position['count']), natural(position['timescale'])
    if not timescale:
        _entry_refused('INVALID_INPUT', 'The file timescale must be positive.')
    return count, timescale


def fileTime(clock, count, timescale):
    position = dict(clock=clock, count=count, timescale=timescale)
    _file_parts(position)
    return position


def fileTimeToTicks(position):
    count, timescale = _file_parts(position)
    ticks, remainder = divmod(count * TICKS_PER_SECOND, timescale)
    if remainder:
        _entry_refused('INEXACT', 'File time falls between whole ticks.')
    return str(Decimal(ticks))


_EXACT_EDGE = object()


def fileTimeToFrames(position, rate, edge=_EXACT_EDGE):
    count, timescale = _file_parts(position)
    rate = _normalized_rate(rate)
    if edge is not _EXACT_EDGE and edge not in ('start', 'end', 'instant'):
        _entry_refused('INVALID_INPUT', 'Expected a start, end or instant edge.')
    frames, remainder = divmod(count * rate['num'], timescale * rate['den'])
    if remainder and edge is _EXACT_EDGE:
        _entry_refused('INEXACT', 'File time falls between whole frames.')
    if remainder and edge == 'start':
        frames += 1
    return makeTime(position['clock'], frames, rate, 'video-frame')


def toOtioFileTime(position):
    count, timescale = _file_parts(position)
    if max(count, timescale) > 9007199254740991:
        _entry_refused('UNREPRESENTABLE', 'OTIO file count and timescale must be safe whole numbers.')
    return {'OTIO_SCHEMA': 'RationalTime.1', 'value': count, 'rate': timescale}


def fromOtioFileTime(clock, value):
    time = fromOtioTime(clock, value)
    if time['rate']['den'] != 1:
        _entry_refused('INVALID_RATE', 'A file timescale must be a whole rate.')
    return fileTime(clock, str(time['frames']), str(time['rate']['num']))


def _otio_rate(value, explicit_rate):
    numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
    if explicit_rate is not _NO_OTIO_RATE:
        rate = _entry_rate(explicit_rate)
        if not numeric or value != rate['num'] / rate['den']:
            _entry_refused('INVALID_RATE', 'OTIO rate must match the explicit rate.')
        return rate
    if numeric:
        whole = _whole_number(value)
        if isinstance(whole, int) and 0 < whole <= 9007199254740991:
            return {'num': whole, 'den': 1}
        for num in (24000, 48000, 30000, 60000):
            if value == num / 1001:
                return {'num': num, 'den': 1001}
    _entry_refused('INVALID_RATE', 'OTIO rate must exactly match a supported frame rate.')


def _otio_object(value, schema):
    if not isinstance(value, dict) or value.get('OTIO_SCHEMA') != schema:
        _entry_refused('INVALID_INPUT', f'Expected OTIO_SCHEMA {schema}.')
    return value


def fromOtioTime(clock, value, rate=_NO_OTIO_RATE):
    time = _otio_object(value, 'RationalTime.1')
    frames = _whole_number(time.get('value'))
    if isinstance(frames, bool) or not isinstance(frames, int) or frames < 0:
        _entry_refused('INVALID_INPUT', 'OTIO value must be a non-negative whole number.')
    if frames > 9007199254740991:
        _entry_refused('UNREPRESENTABLE', 'OTIO value exceeds the safe whole-frame range.')
    return _entry_frame(clock, frames, _otio_rate(time.get('rate'), rate))


def fromOtioRange(clock, value, rate=_NO_OTIO_RATE):
    source = _otio_object(value, 'TimeRange.1')
    start = fromOtioTime(clock, source.get('start_time'), rate)
    duration = fromOtioTime(clock, source.get('duration'), rate)
    if start['rate'] != duration['rate']:
        _entry_refused('INVALID_RATE', 'OTIO range start and duration must have the same rate.')
    return {'start': start, 'duration': duration}


def snapDecimalSeconds(clock, seconds, rate, edge=None):
    if edge not in ('start', 'end', 'instant'):
        raise _refusal('INVALID_INPUT', 'A frame edge is required. Accepted forms: start, end or instant.')
    if not isinstance(seconds, str) or not re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?', seconds):
        raise _refusal('INVALID_INPUT', 'Expected decimal seconds as text. Accepted forms: an unsigned unpadded whole number with an optional fraction, such as 0 or 5.010.')
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
        _entry_refused('INVALID_RATE', 'Above 1000 fps two frames can share one whole millisecond. Use a declared video rate of at most 1000 fps.')
    return scale


def fromPremiereMilliseconds(clock, ms, rate):
    if not isinstance(ms, str):
        _entry_refused('INVALID_INPUT', 'Expected whole milliseconds as text.')
    if not re.fullmatch(r'0|[1-9][0-9]*', ms):
        _entry_refused('INVALID_INPUT', 'Expected a non-negative unpadded whole number.')
    value = int(Decimal(ms))
    rate = _entry_rate(rate)
    scale = _premiere_scale(rate)
    frame = (value * rate['num'] + scale - 1) // scale
    if frame * scale >= (value + 1) * rate['num']:
        _entry_refused('UNREPRESENTABLE', f'No frame writes {ms} ms. It falls between the values written by frames {Decimal(frame - 1)} and {Decimal(frame)}.')
    return _entry_frame(clock, frame, rate)


def toPremiereMilliseconds(time):
    if not isinstance(time, dict) or time.get('unit') != 'video-frame':
        _entry_refused('INVALID_INPUT', 'Premiere milliseconds require an exact video frame at a declared video rate.')
    rate = _entry_rate(time.get('rate'))
    return str(Decimal(time['frames'] * _premiere_scale(rate) // rate['num']))


def nominalRate(time, dropFrame):
    if time['unit'] != 'video-frame':
        raise _refusal('INVALID_INPUT', 'Timecode requires a declared video rate.')
    if not isinstance(dropFrame, bool):
        raise _refusal('INVALID_TIMECODE', 'Drop-frame must be stated.')
    if dropFrame and not isDropRate(time['rate']):
        raise _refusal('INVALID_RATE', 'Drop-frame requires 30000/1001 or 60000/1001.')
    num, den = _rate_components(time['rate'])
    return (num + den - 1) // den


def renderExactTimecode(time, dropFrame=None):
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


@_classify('INVALID_TIMECODE')
def fromTimecode(clock, value, rate, dropFrame):
    zero = exactTime(clock, '0', rate)
    nominal = nominalRate(zero, dropFrame)
    m = re.fullmatch(r'(\d{2}|[1-9]\d{2,}):([0-5]\d):([0-5]\d)([:;])(\d{2}|[1-9]\d{2,})', value, re.ASCII)
    if not m:
        raise _refusal('INVALID_TIMECODE', 'Malformed timecode.')
    if m[4] != (';' if dropFrame else ':'):
        raise _refusal('INVALID_TIMECODE', 'Timecode separator must match the stated drop-frame choice.')
    h, mi, s, ff = (int(m[i]) for i in (1, 2, 3, 5))
    if ff >= nominal:
        raise _refusal('INVALID_TIMECODE', 'Frame field must be below the nominal rate.')
    drop = (4 if nominal == 60 else 2) if dropFrame else 0
    if dropFrame and mi % 10 and s == 0 and ff < drop:
        raise _refusal('INVALID_TIMECODE', 'Drop-frame label does not exist.')
    minutes = h * 60 + mi
    return exactTime(clock, str((minutes * 60 + s) * nominal + ff - drop * (minutes - minutes // 10)), rate)


def ticksPerFrame(time):
    num, den = _rate_components(time['rate'])
    value, remainder = divmod(TICKS_PER_SECOND * den, num)
    return None if remainder else value


def ticksAtGrid(frames, grid):
    step = natural(grid)
    if not step:
        raise _refusal('INVALID_INPUT', 'Ticks per frame must be positive.')
    return str(Decimal(natural(frames) * step))


def _time_at_ticks(clock, ticks, rate, exact):
    value = natural(ticks)
    # The containing reader includes entry guidance in its invalid-rate message.
    if not exact and rate is not None:
        rate = _entry_rate(rate)
    zero = exactTime(clock, '0', rate) if rate else fromMilliseconds(clock, '0')
    step = ticksPerFrame(zero)
    if step is None:
        raise _refusal('UNREPRESENTABLE', 'Ticks per frame are not whole at this rate.')
    if exact and value % step:
        raise _refusal('NOT_ON_FRAME_BOUNDARY', 'Ticks must identify an exact frame boundary.')
    return makeTime(clock, value // step, zero['rate'], zero['unit'])


def fromTicks(clock, ticks, rate=None):
    return _time_at_ticks(clock, ticks, rate, True)


def fromContainingTicks(clock, ticks, rate=None):
    return _time_at_ticks(clock, ticks, rate, False)


def deriveExact(time, dropFrame=None):
    f, r = time['frames'], time['rate']
    num, den = _rate_components(r)
    ms = (f * 1000 * den + num - 1) // num
    out = {'clock': time['clock'], 'secondsDerived': True}
    if ms * num >= (f + 1) * 1000 * den:
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
        raise _refusal('UNREPRESENTABLE', result['secondsUnavailable'])
    return result['seconds']


def offsetTime(time, offset):
    if time['rate'] != offset['rate'] or time['unit'] != offset['unit']:
        raise _refusal('INVALID_INPUT', 'Exact offsets require the same rate and unit.')
    return makeTime(offset['clock'], time['frames'] + offset['frames'], offset['rate'], offset['unit'])


# Boundary adapters used by the existing tools. They do not choose a video rate
# for an audio clock, or a drop-frame policy from a fractional number alone.
def _ascii_digits(value):
    # int and Fraction accept Unicode decimal digits in otherwise valid numeric text.
    if isinstance(value, str) and not value.isascii():
        if any(char.isdecimal() and not char.isascii() for char in value):
            raise _refusal('INVALID_INPUT', 'Expected ASCII digits.')
    return value


@_classify('INVALID_INPUT')
def _fraction(value):
    return Fraction(_ascii_digits(str(value)))


@_classify('INVALID_RATE')
def rate(value):
    if isinstance(value, dict):
        return rationalRate(value.get('num', value.get('numerator')), value.get('den', value.get('denominator')))
    if isinstance(value, float) and value == round(value * 1001) / 1001:
        return rationalRate(round(value * 1001), 1001)
    text = _ascii_digits(str(value))
    aliases = {'23.976': (24000, 1001), '29.97': (30000, 1001), '47.952': (48000, 1001), '59.94': (60000, 1001)}
    f = Fraction(*aliases[text]) if text in aliases else Fraction(text)
    return rationalRate(f.numerator, f.denominator)


def seconds_frames(seconds, fps, offset=0):
    r = rate(fps)
    s = _fraction(seconds) + _fraction(offset)
    if s < 0:
        raise _refusal('INVALID_INPUT', 'Negative instant.')
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


@_classify('INVALID_INPUT')
def ticks_seconds(ticks):
    return Fraction(int(_ascii_digits(ticks)), TICKS_PER_SECOND)


def subtitle(seconds):
    ms = math.ceil(_fraction(seconds) * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


@_classify('INVALID_INPUT')
def clock_fraction(value):
    text = _ascii_digits(str(value)).replace(',', '.')
    if ':' not in text:
        result = Fraction(text)
    else:
        parts = text.split(':')
        if len(parts) == 2:
            parts.insert(0, '00')
        if len(parts) != 3 or not re.fullmatch(r'[0-9]+', parts[0]) or not re.fullmatch(r'[0-9]+', parts[1]):
            raise _refusal('INVALID_INPUT', 'Expected HH:MM:SS(.mmm).')
        h, m = map(int, parts[:2]); sec = Fraction(parts[2])
        if not 0 <= m < 60 or not 0 <= sec < 60:
            raise _refusal('INVALID_INPUT', 'Clock field out of range.')
        result = h * 3600 + m * 60 + sec
    if result < 0:
        raise _refusal('INVALID_INPUT', 'Negative clock.')
    return result


def clock_seconds(value):
    return float(clock_fraction(value))


def seconds_ticks(value):
    result = _fraction(value) * TICKS_PER_SECOND
    if result.denominator != 1:
        raise _refusal('UNREPRESENTABLE', 'Seconds are not an exact tick boundary.')
    return result.numerator


def frame_ticks(frame, grid):
    return natural(str(frame)) * natural(str(grid))


def frames_from_grid(ticks, grid):
    value, step = natural(str(ticks)), natural(str(grid))
    if not step or value % step:
        raise _refusal('NOT_ON_FRAME_BOUNDARY', 'Ticks must identify an exact frame boundary.')
    return value // step


@_classify('INVALID_RATE')
def xml_rate(node):
    nominal = int(_ascii_digits(node.findtext('rate/timebase')))
    return Fraction(nominal * 1000, 1001) if node.findtext('rate/ntsc') == 'TRUE' else Fraction(nominal, 1)


def seconds_display(seconds):
    ms = math.ceil(_fraction(seconds) * 1000)
    return ms / 1000


def relative_frame_seconds(frame, origin, fps):
    r = rate(fps)
    return seconds_display(Fraction((frame-origin)*r['den'], r['num']))


def seconds_difference(end, start):
    return _fraction(end) - _fraction(start)


def infer_nominal_rate(text):
    """Legacy subtitle metadata heuristic; not evidence of an exact media rate."""
    fields = [int(x) for x in re.findall(r'\d{1,2}:\d{2}:\d{2}:(\d{2})', text, re.ASCII)]
    maximum = max(fields) if fields else 0
    guess = {23: 24, 24: 25, 29: 30, 25: 'odd', 59: 60}.get(maximum) if len(fields) >= 30 else None
    return guess, len(fields), maximum
