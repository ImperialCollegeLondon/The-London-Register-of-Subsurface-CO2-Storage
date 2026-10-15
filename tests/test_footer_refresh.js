const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
const keys = ['annual-2026', 'methodology-2026', 'assurance-2026', 'table-csv', 'zenodo', 'website-visits'];
const snapshot = () => ({ version: 1, available: true, start: '2026-10-15', generated: '2026-10-15 16:50 UTC',
    counts: Object.fromEntries(keys.map(key => [key, key === 'table-csv' ? 4 : 20])),
    countries: { China: 12, 'United Kingdom': 7 }, has_countries: true });

async function setup() {
    const counters = keys.map(key => ({ dataset: { statKey: key }, textContent: '2' }));
    const countries = ['China', 'United Kingdom'].map(name => ({
        dataset: { country: name, count: '0' }, title: {},
        setAttribute(name, value) { this[name] = value; },
        querySelector() { return this.title; },
    }));
    const updated = {};
    const note = {};
    const footer = {
        dataset: { statsUrl: '/subpath/statistics.json', statsGenerated: '2026-10-15 16:49 UTC' },
        querySelectorAll(selector) { return selector === '[data-stat-key]' ? counters : countries; },
        querySelector(selector) { return selector === '.stats-updated' ? updated : note; },
    };
    const listeners = {};
    const document = { visibilityState: 'visible', querySelector: () => footer,
        addEventListener: (name, fn) => { listeners[name] = fn; } };
    const state = { payload: snapshot(), requests: 0 };
    const context = { document, Intl, AbortController,
        setTimeout: () => 1, clearTimeout() {},
        setInterval: (fn, ms) => { state.tick = fn; state.interval = ms; },
        fetch: async (url, options) => {
            state.requests++;
            assert.equal(url, '/subpath/statistics.json');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.mode, 'same-origin');
            if (state.failure) throw new Error('Offline');
            return { ok: true, json: async () => state.payload };
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/footer-stats.js'), 'utf8'), context);
    await settle();
    return { counters, countries, footer, updated, note, document, listeners, state };
}

test('published counts and map update on the one-minute timer without a page reload', async () => {
    const { counters, countries, updated, state } = await setup();
    assert.equal(state.interval, 60000);
    assert.equal(counters[3].textContent, '4');
    assert.equal(countries[0].dataset.count, '12');
    assert.equal(countries[0].class, 'visitor-country visits-medium');
    assert.equal(countries[0].title.textContent, 'China: 12 recorded visits');
    state.payload = snapshot(); state.payload.counts['table-csv'] = 6;
    state.payload.generated = '2026-10-15 17:05 UTC';
    await state.tick();
    assert.equal(counters[3].textContent, '6');
    assert(updated.textContent.includes('Updated 2026-10-15 17:05 UTC.'));
});

test('malformed, unavailable, stale and offline snapshots preserve all displayed values', async () => {
    const { counters, countries, footer, state } = await setup();
    for (const change of [
        data => { delete data.counts['website-visits']; },
        data => { data.countries.China = -1; },
        data => { data.available = false; },
        data => { data.generated = '2026-10-15 16:00 UTC'; },
    ]) {
        state.payload = snapshot(); state.payload.counts['table-csv'] = 99; change(state.payload);
        await state.tick();
        assert.equal(counters[3].textContent, '4');
        assert.equal(countries[0].dataset.count, '12');
        assert.equal(footer.dataset.statsGenerated, '2026-10-15 16:50 UTC');
    }
    state.failure = true; await state.tick();
    assert.equal(counters[3].textContent, '4');
});

test('hidden tabs pause fetching and refresh when visible again', async () => {
    const { state, document, listeners } = await setup();
    document.visibilityState = 'hidden'; await state.tick();
    assert.equal(state.requests, 1);
    document.visibilityState = 'visible'; await listeners.visibilitychange();
    assert.equal(state.requests, 2);
});
