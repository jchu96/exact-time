/* ES3 implementation of the public time table. Decimal-string arithmetic keeps
   ticks exact beyond the double integer limit. Node vm is not Premiere proof. */
var ExactTime = (function () {
    var TPS = '254016000000';
    function fail(code, message) {
        var error = new Error(message);
        error.code = code;
        throw error;
    }
    function norm(s) { s = String(s).replace(/^0+/, ''); return s || '0'; }
    function cmp(a, b) {
        a = norm(a); b = norm(b);
        if (a.length !== b.length) return a.length > b.length ? 1 : -1;
        if (a === b) return 0;
        return a > b ? 1 : -1;
    }
    function add(a, b) {
        var i = a.length - 1, j = b.length - 1, carry = 0, out = '', n;
        while (i >= 0 || j >= 0 || carry) {
            n = carry;
            if (i >= 0) n += Number(a.charAt(i--));
            if (j >= 0) n += Number(b.charAt(j--));
            out = String(n % 10) + out; carry = Math.floor(n / 10);
        }
        return norm(out);
    }
    function sub(a, b) {
        if (cmp(a, b) < 0) fail('INVALID_INPUT', 'Negative exact result.');
        var i = a.length - 1, j = b.length - 1, borrow = 0, out = '', n;
        while (i >= 0) {
            n = Number(a.charAt(i--)) - borrow;
            if (j >= 0) n -= Number(b.charAt(j--));
            borrow = 0;
            if (n < 0) { n += 10; borrow = 1; }
            out = String(n) + out;
        }
        return norm(out);
    }
    function mul(a, b) {
        var out = '0', shift = '', i, j, row;
        for (i = b.length - 1; i >= 0; i--) {
            row = '0';
            for (j = 0; j < Number(b.charAt(i)); j++) row = add(row, a);
            out = add(out, norm(row + shift)); shift += '0';
        }
        return out;
    }
    function divmod(a, b) {
        if (norm(b) === '0') fail('INVALID_INPUT', 'Division by zero.');
        var q = '', r = '0', i, digit;
        for (i = 0; i < a.length; i++) {
            r = norm(r + a.charAt(i)); digit = 0;
            while (cmp(r, b) >= 0) { r = sub(r, b); digit++; }
            q += String(digit);
        }
        return [norm(q), r];
    }
    function div(a, b) { return divmod(a, b)[0]; }
    function mod(a, b) { return divmod(a, b)[1]; }
    function gcd(a, b) {
        var r;
        while (b !== '0') { r = mod(a, b); a = b; b = r; }
        return a;
    }
    function pad(s) { return s.length < 2 ? '0' + s : s; }
    function natural(s) {
        if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s) || /\s/.test(s)) fail('INVALID_INPUT', 'Expected a non-negative unpadded whole number.');
        return s;
    }
    function rationalRate(num, den) {
        if (typeof num !== 'number' || typeof den !== 'number' || num < 1 || den < 1 ||
            num > 9007199254740991 || den > 9007199254740991 || Math.floor(num) !== num || Math.floor(den) !== den)
            fail('INVALID_RATE', 'Rate must contain positive safe whole numbers.');
        var a = gcd(String(num), String(den));
        return {num: Number(div(String(num), a)), den: Number(div(String(den), a))};
    }
    function isDropRate(r) {
        try {
            var n = mul(String(r.num), '1001'), d = String(r.den);
            return n === mul('30000', d) || n === mul('60000', d);
        } catch (error) { error.code = 'INVALID_RATE'; throw error; }
    }
    function parseTimecodeRate(value) {
        var m = /^(.*?)(?::?(ndf|df))?$/.exec(value), r, name, choice, pair;
        var aliases = {'23.976':[24000,1001], '47.952':[48000,1001], '29.97':[30000,1001], '59.94':[60000,1001]};
        if (!m || m[0] !== value) fail('INVALID_RATE', 'Unsupported or ambiguous timecode rate.');
        name = m[1]; choice = m[2];
        if (Object.prototype.hasOwnProperty.call(aliases, name)) { pair = aliases[name]; r = rationalRate(pair[0], pair[1]); }
        else if (/^(24|25|30|48|50|60)$/.test(name)) r = rationalRate(Number(name), 1);
        else if (/^[1-9][0-9]*\/[1-9][0-9]*$/.test(name)) {
            pair = name.split('/');
            try { r = rationalRate(Number(pair[0]), Number(pair[1])); }
            catch (e) { fail('INVALID_RATE', 'Unsupported or ambiguous timecode rate.'); }
        }
        if (!r || (isDropRate(r) && !choice) || (choice === 'df' && !isDropRate(r))) fail('INVALID_RATE', 'Unsupported or ambiguous timecode rate.');
        return {rate:r, dropFrame:choice === 'df', rateOrigin:'declared'};
    }
    var mediaClocks = ['source', 'reel', 'timeline'];
    function parseMediaClock(value) {
        for (var i = 0; i < mediaClocks.length; i++) {
            if (value === mediaClocks[i]) return value;
        }
        fail('INVALID_INPUT', 'Expected a source, reel or timeline clock; time of day is not a cut point.');
    }
    function makeTime(clock, frames, rate, unit) {
        parseMediaClock(clock);
        return {clock:clock, frames:frames, rate:rate, unit:unit};
    }
    function normalizedRate(rate) {
        try { return rationalRate(rate.num, rate.den); }
        catch (error) { error.code = 'INVALID_RATE'; throw error; }
    }
    function exactTime(clock, frames, rate) {
        return makeTime(clock, natural(frames), normalizedRate(rate), 'video-frame');
    }
    function fromMilliseconds(clock, ms, rate) {
        natural(ms);
        if (!rate) return makeTime(clock, ms, {num:1000, den:1}, 'millisecond');
        rate = normalizedRate(rate);
        return makeTime(clock, div(mul(ms, String(rate.num)), mul('1000', String(rate.den))), rate, 'video-frame');
    }
    function entryRefused(code, reason) {
        fail(code, reason + ' Accepted forms: unsigned whole frames, ticks or milliseconds; HH:MM:SS:FF (non-drop) or HH:MM:SS;FF (drop), at a declared rate.');
    }
    function entryRate(rate) {
        try { return rationalRate(rate.num, rate.den); }
        catch (e) { entryRefused('INVALID_RATE', 'Rate must contain positive safe whole numbers.'); }
    }
    function entryFrame(clock, frames, rate) {
        try { return makeTime(clock, frames, rate, 'video-frame'); }
        catch (e) { entryRefused(e.code, e.message); }
    }
    function snapDecimalSeconds(clock, seconds, rate, edge) {
        if (edge !== 'start' && edge !== 'end' && edge !== 'instant')
            fail('INVALID_INPUT', 'A frame edge is required. Accepted forms: start, end or instant.');
        if (typeof seconds !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(seconds) || /\s/.test(seconds))
            fail('INVALID_INPUT', 'Expected decimal seconds as text. Accepted forms: an unsigned unpadded whole number with an optional fraction, such as 0 or 5.010.');
        rate = entryRate(rate);
        var fraction = seconds.split('.')[1] || '';
        var scale = '1' + fraction.replace(/[0-9]/g, '0');
        var position = mul(norm(seconds.replace('.', '')), String(rate.num));
        var step = mul(scale, String(rate.den));
        var qr = divmod(position, step), frame = qr[0], distance = qr[1], sign = '';
        if (distance !== '0') {
            if (edge === 'start') {
                frame = add(frame, '1');
                distance = sub(step, distance);
            } else {
                sign = '-';
            }
        }
        var denominator = mul(scale, String(rate.num)), common = gcd(distance, denominator);
        var time = entryFrame(clock, frame, rate);
        time.askedSeconds = seconds;
        time.edge = edge;
        time.moved = distance !== '0';
        time.movement = {numerator:sign + div(distance, common), denominator:div(denominator, common)};
        return time;
    }
    function premiereScale(rate) {
        var scale = mul('1000', String(rate.den));
        if (cmp(String(rate.num), scale) > 0)
            entryRefused('INVALID_RATE', 'Above 1000 fps two frames can share one whole millisecond. Use a declared video rate of at most 1000 fps.');
        return scale;
    }
    function fromPremiereMilliseconds(clock, ms, rate) {
        if (typeof ms !== 'string') entryRefused('INVALID_INPUT', 'Expected whole milliseconds as text.');
        try { natural(ms); } catch (e) { entryRefused(e.code, e.message); }
        rate = entryRate(rate);
        var scale = premiereScale(rate), num = String(rate.num);
        var qr = divmod(mul(ms, num), scale);
        var frame = qr[1] === '0' ? qr[0] : add(qr[0], '1');
        if (cmp(mul(frame, scale), mul(add(ms, '1'), num)) >= 0)
            entryRefused('UNREPRESENTABLE', 'No frame writes ' + ms + ' ms. It falls between the values written by frames ' + sub(frame, '1') + ' and ' + frame + '.');
        return entryFrame(clock, frame, rate);
    }
    function toPremiereMilliseconds(time) {
        if (!time || time.unit !== 'video-frame')
            entryRefused('INVALID_INPUT', 'Premiere milliseconds require an exact video frame at a declared video rate.');
        return div(mul(time.frames, premiereScale(time.rate)), String(time.rate.num));
    }
    function nominalRate(time, dropFrame) {
        if (time.unit !== 'video-frame') fail('INVALID_INPUT', 'Timecode requires a declared video rate.');
        if (typeof dropFrame !== 'boolean') fail('INVALID_TIMECODE', 'Drop-frame must be stated.');
        if (dropFrame && !isDropRate(time.rate)) fail('INVALID_RATE', 'Drop-frame requires 30000/1001 or 60000/1001.');
        return div(add(String(time.rate.num), sub(String(time.rate.den), '1')), String(time.rate.den));
    }
    function renderExactTimecode(time, dropFrame) {
        var n = nominalRate(time, dropFrame), f = time.frames, drop, ten, minute, remainder, extra, seconds;
        if (dropFrame) {
            drop = n === '60' ? '4' : '2';
            ten = sub(mul(n, '600'), mul(drop, '9'));
            minute = sub(mul(n, '60'), drop); remainder = mod(f, ten);
            extra = '0';
            if (cmp(remainder, drop) >= 0) extra = mul(drop, div(sub(remainder, drop), minute));
            f = add(f, add(mul(mul(drop, '9'), div(f, ten)), extra));
        }
        seconds = div(f, n);
        return pad(div(seconds, '3600')) + ':' + pad(mod(div(seconds, '60'), '60')) + ':' + pad(mod(seconds, '60')) + (dropFrame ? ';' : ':') + pad(mod(f, n));
    }
    function fromTimecode(clock, value, rate, dropFrame) {
        var z = exactTime(clock, '0', rate), n = nominalRate(z, dropFrame);
        var m = /^(\d{2}|[1-9]\d{2,}):([0-5]\d):([0-5]\d)([:;])(\d{2}|[1-9]\d{2,})$/.exec(value);
        var h, mi, s, f, drop = '0', minutes, total;
        if (!m || m[0] !== value) fail('INVALID_TIMECODE', 'Malformed timecode.');
        if (m[4] !== (dropFrame ? ';' : ':')) fail('INVALID_TIMECODE', 'Timecode separator must match the stated drop-frame choice.');
        h = norm(m[1]); mi = norm(m[2]); s = norm(m[3]); f = norm(m[5]);
        if (cmp(f, n) >= 0) fail('INVALID_TIMECODE', 'Frame field must be below the nominal rate.');
        if (dropFrame) drop = n === '60' ? '4' : '2';
        if (dropFrame && mod(mi, '10') !== '0' && s === '0' && cmp(f, drop) < 0) fail('INVALID_TIMECODE', 'Drop-frame label does not exist.');
        minutes = add(mul(h, '60'), mi);
        total = sub(add(mul(add(mul(minutes, '60'), s), n), f), mul(drop, sub(minutes, div(minutes, '10'))));
        return exactTime(clock, total, rate);
    }
    function ticksPerFrame(time) {
        var result = divmod(mul(TPS, String(time.rate.den)), String(time.rate.num));
        if (result[1] !== '0') return null;
        return result[0];
    }
    // Premiere already supplies the exact tick grid of a source or sequence.
    function ticksAtGrid(frames, step) {
        if (natural(step) === '0') fail('INVALID_INPUT', 'Ticks per frame must be positive.');
        return mul(step, natural(frames));
    }
    function timeAtTicks(clock, ticks, rate, exact) {
        var value = natural(ticks), z, step;
        z = rate ? exactTime(clock, '0', rate) : fromMilliseconds(clock, '0'); step = ticksPerFrame(z);
        if (step === null) fail('UNREPRESENTABLE', 'Ticks per frame are not whole at this rate.');
        var position = divmod(value, step);
        if (exact && position[1] !== '0') fail('NOT_ON_FRAME_BOUNDARY', 'Ticks must identify an exact frame boundary.');
        return makeTime(clock, position[0], z.rate, z.unit);
    }
    function fromTicks(clock, ticks, rate) { return timeAtTicks(clock, ticks, rate, true); }
    function fromContainingTicks(clock, ticks, rate) { return timeAtTicks(clock, ticks, rate, false); }
    var otioRates = [
        [24, 1], [25, 1], [30, 1], [48, 1], [50, 1], [60, 1],
        [24000, 1001], [48000, 1001], [30000, 1001], [60000, 1001]
    ];
    function otioObject(input, schema) {
        if (!input || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]' || input.OTIO_SCHEMA !== schema)
            entryRefused('INVALID_INPUT', 'Expected OTIO_SCHEMA ' + schema + '.');
        return input;
    }
    function fromOtioTime(clock, input) {
        var time = otioObject(input, 'RationalTime.1');
        var value = time.value, rate = time.rate, i, pair;
        if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value || value < 0)
            entryRefused('INVALID_INPUT', 'OTIO value must be a non-negative whole number.');
        if (value > 9007199254740991)
            entryRefused('UNREPRESENTABLE', 'OTIO value exceeds the safe whole-frame range.');
        for (i = 0; i < otioRates.length; i++) {
            pair = otioRates[i];
            if (rate === pair[0] / pair[1])
                return entryFrame(clock, String(value), {num:pair[0], den:pair[1]});
        }
        entryRefused('INVALID_RATE', 'OTIO rate must exactly match a supported frame rate.');
    }
    function fromOtioRange(clock, input) {
        var range = otioObject(input, 'TimeRange.1');
        var start = fromOtioTime(clock, range.start_time);
        var duration = fromOtioTime(clock, range.duration);
        if (start.rate.num !== duration.rate.num || start.rate.den !== duration.rate.den)
            entryRefused('INVALID_RATE', 'OTIO range start and duration must have the same rate.');
        return {start:start, duration:duration};
    }
    function deriveExact(time, dropFrame) {
        var f = time.frames, n = String(time.rate.num), d = String(time.rate.den);
        var ms = div(add(mul(mul(f, '1000'), d), sub(n, '1')), n);
        var out = {clock:time.clock, secondsDerived:true}, step = ticksPerFrame(time), frac;
        if (cmp(mul(ms, n), mul(mul(add(f, '1'), '1000'), d)) >= 0)
            out.secondsUnavailable = 'No whole millisecond falls inside this frame; three-decimal derived seconds are unavailable.';
        else {
            frac = mod(ms, '1000'); while (frac.length < 3) frac = '0' + frac;
            out.seconds = div(ms, '1000') + '.' + frac;
        }
        if (step === null) out.ticksUnavailable = 'Ticks per frame are not whole at this rate.';
        else out.ticks = ticksAtGrid(f, step);
        if (time.unit === 'millisecond') {
            out.milliseconds = f; out.rateBasis = 'whole-millisecond source; no declared video rate';
        } else {
            out.frames = f; out.rate = time.rate; out.timecode = renderExactTimecode(time, dropFrame); out.dropFrame = dropFrame;
        }
        return out;
    }
    function exactSeconds(time) {
        var d = deriveExact(time, false);
        if (d.seconds === undefined) fail('UNREPRESENTABLE', d.secondsUnavailable);
        return d.seconds;
    }
    function offsetTime(time, offset) {
        if (time.rate.num !== offset.rate.num || time.rate.den !== offset.rate.den || time.unit !== offset.unit)
            fail('INVALID_INPUT', 'Exact offsets require the same rate and unit.');
        return makeTime(offset.clock, add(time.frames, offset.frames), offset.rate, offset.unit);
    }
    // Validation uses the private list even on hosts that cannot freeze the public copy.
    var publicClocks = mediaClocks.slice(0);
    if (typeof Object.freeze === 'function') Object.freeze(publicClocks);
    return {MEDIA_CLOCKS:publicClocks, mediaClockSchema:{parse:parseMediaClock},
        TICKS_PER_SECOND:TPS, ticksAtGrid:ticksAtGrid, rationalRate:rationalRate, isDropRate:isDropRate,
        parseTimecodeRate:parseTimecodeRate, exactTime:exactTime, fromMilliseconds:fromMilliseconds,
        snapDecimalSeconds:snapDecimalSeconds, fromPremiereMilliseconds:fromPremiereMilliseconds,
        toPremiereMilliseconds:toPremiereMilliseconds,
        fromTicks:fromTicks, fromContainingTicks:fromContainingTicks, fromTimecode:fromTimecode, deriveExact:deriveExact,
        fromOtioTime:fromOtioTime, fromOtioRange:fromOtioRange,
        renderExactTimecode:renderExactTimecode, exactSeconds:exactSeconds, offsetTime:offsetTime};
}());

// CommonJS hosts load the same source as an ordinary script module.
if (typeof module !== 'undefined') module.exports = ExactTime;
