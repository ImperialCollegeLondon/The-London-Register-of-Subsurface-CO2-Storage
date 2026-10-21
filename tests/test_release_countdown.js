const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const target = Date.parse('2026-10-25T23:55:00Z');

function setup(now, reducedMotion = false, available = false) {
    const state = { now, scheduled: null };
    const units = ['days', 'hours', 'minutes', 'seconds'].map(name => {
        const classes = new Set();
        const children = Object.fromEntries(['value', 'previous', 'top', 'bottom'].map(part => ['.release-flip-' + part, { textContent: '00' }]));
        const card = { offsetWidth: 50, classList: {
            add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        }, querySelector: selector => children[selector], addEventListener() {} };
        return { dataset: { unit: name }, card, children, querySelector: () => card };
    });
    const status = { hidden: true, textContent: '' };
    const prefix = { textContent: 'The 2026 materials will be published on ' };
    const parent = { querySelector: selector => selector === '.release-countdown-status' ? status : prefix };
    const editionListeners = {};
    const edition = { dataset: { releaseAvailable: String(available) },
        addEventListener: (type, callback) => { editionListeners[type] = callback; } };
    const timer = { hidden: true, dataset: { releaseTime: 'release-2026-time' },
        closest: selector => selector === '.release-edition' ? edition : parent, querySelectorAll: () => units,
        setAttribute(name, value) { this[name] = value; } };
    const listeners = {};
    const document = { visibilityState: 'visible', querySelectorAll: () => [timer],
        getElementById: () => ({ dateTime: '2026-10-26T07:55:00+08:00' }),
        addEventListener: (name, fn) => { listeners[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/release-countdown.js'), 'utf8'), {
        document, window: { matchMedia: () => ({ matches: reducedMotion }) },
        Date: { parse: Date.parse, now: () => state.now },
        setTimeout: (fn, delay) => { state.scheduled = { fn, delay }; return 1; },
        clearTimeout: () => { state.scheduled = null; },
    });
    const values = () => units.map(unit => unit.children['.release-flip-value'].textContent);
    return { state, timer, status, prefix, units, document, listeners, values, edition, editionListeners };
}

test('07:55 Perth on 26 October counts down to 23:55 UK time and UTC on 25 October', () => {
    const { values, timer } = setup(target - (86400 + 3600 + 60 + 1) * 1000);
    assert.deepEqual(values(), ['01', '01', '01', '01']);
    assert.equal(timer.hidden, false);
    assert.match(timer['aria-label'], /^1 day, 1 hour, 1 minute, 1 second/);
});

test('last millisecond does not expire early; expiry stops without claiming files are available', () => {
    const { state, values, timer, status } = setup(target - 1);
    assert.deepEqual(values(), ['00', '00', '00', '01']);
    assert.equal(timer.hidden, false);
    const tick = state.scheduled.fn;
    state.now = target; tick();
    assert.equal(timer.hidden, true);
    assert.equal(state.scheduled, null);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Publication is pending/);
    assert.doesNotMatch(status.textContent, /now available|download now/i);
    const late = setup(target + 100000);
    assert.equal(late.timer.hidden, true);
    assert.equal(late.state.scheduled, null);
});

test('hidden tabs pause; resuming recomputes the elapsed time without drift', () => {
    const { state, document, listeners, values } = setup(target - 100000);
    document.visibilityState = 'hidden'; listeners.visibilitychange();
    assert.equal(state.scheduled, null);
    state.now += 65000;
    document.visibilityState = 'visible'; listeners.visibilitychange();
    assert.deepEqual(values(), ['00', '00', '00', '35']);
    assert(state.scheduled.delay > 0 && state.scheduled.delay <= 1000);
});

test('reduced-motion visitors get current numbers without flip animation', () => {
    const { state, units, values } = setup(target - 10000, true);
    state.now += 1000; state.scheduled.fn();
    assert.deepEqual(values(), ['00', '00', '00', '09']);
    assert(units.every(unit => !unit.card.classList.contains('is-flipping')));
});


test('only verified availability stops the countdown and announces the download, even with a slow client clock', () => {
    const result = setup(target - 10000);
    result.edition.dataset.releaseAvailable = 'true';
    result.editionListeners['release:available']();
    assert.equal(result.timer.hidden, true);
    assert.equal(result.state.scheduled, null);
    assert.match(result.status.textContent, /now available/);
    const ready = setup(target - 10000, false, true);
    assert.equal(ready.timer.hidden, true);
    assert.equal(ready.state.scheduled, null);
});
