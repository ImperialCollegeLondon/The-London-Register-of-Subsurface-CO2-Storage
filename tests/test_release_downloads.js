const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const releaseAt = '2026-10-25T23:55:00Z';
const deadline = Date.parse(releaseAt);
const repository = 'ImperialCollegeLondon/The-London-Register-of-Subsurface-CO2-Storage';
const files = [
    ['London_Register_Annual_Report_2026.pdf', 'Annual Report 2026'],
    ['DNV_Data_Assurance_Summary_2026.pdf', 'DNV Assessment Report 2026'],
    ['London_Register_Methodology_2026.pdf', 'Methodology Report 2026'],
].map(([filename, title], index) => ({ filename, title, size: 100 + index, sha256: String(index + 1).repeat(64) }));
const url = item => `https://github.com/${repository}/releases/download/2026-materials/${item.filename}`;
const snapshot = (available = true) => ({ available, release_at: releaseAt,
    checked_at: '2026-10-25T23:55:02Z', documents: files.map(({ filename, size, sha256 }) => ({ filename, size, sha256 })) });
const published = () => ({ draft: false, prerelease: false, tag_name: '2026-materials', published_at: '2026-10-25T23:55:01Z',
    assets: files.map(item => ({ name: item.filename, size: item.size, state: 'uploaded',
        digest: 'sha256:' + item.sha256, browser_download_url: url(item) })) });
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
    constructor(tag = 'div', attrs = {}) {
        this.tagName = tag.toUpperCase(); this.attrs = {}; this.dataset = {}; this.childNodes = [];
        Object.entries(attrs).forEach(([name, value]) => this.setAttribute(name, value));
        this.classList = {
            contains: value => (this.attrs.class || '').split(' ').includes(value),
            remove: value => { this.attrs.class = (this.attrs.class || '').split(' ').filter(item => item !== value).join(' '); },
        };
    }
    setAttribute(name, value) {
        this.attrs[name] = String(value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    get firstChild() { return this.childNodes[0]; }
    appendChild(child) {
        if (child.parent) child.parent.childNodes.splice(child.parent.childNodes.indexOf(child), 1);
        child.parent = this; this.childNodes.push(child);
    }
    replaceWith(replacement) { this.replacement = replacement; }
    querySelector(selector) {
        for (const child of this.childNodes) {
            if (child.classList.contains(selector.slice(1))) return child;
            const match = child.querySelector(selector); if (match) return match;
        }
        return null;
    }
}

async function setup(now = deadline + 1000) {
    const cards = files.map(item => {
        const card = new Element('article', { class: 'download-card release-document is-embargoed',
            'data-document-filename': item.filename, 'data-document-title': item.title,
            'data-document-size': item.size, 'data-document-sha256': item.sha256 });
        const hint = new Element('div', { class: 'release-download-state' }); hint.textContent = 'Embargo';
        card.appendChild(hint); return card;
    });
    const status = { hidden: true, textContent: '' };
    const countdown = { hidden: false };
    const prefix = {};
    const edition = { dataset: { releaseAt, releaseAvailable: 'false', releaseRepository: repository,
        releaseTag: '2026-materials', releaseStatusUrl: '/register/release-2026-status.json' },
        querySelectorAll: () => cards,
        querySelector: selector => ({ '.release-countdown': countdown, '.release-countdown-status': status,
            '.release-announcement-prefix': prefix })[selector],
        dispatchEvent: event => { state.events.push(event.type); },
    };
    const listeners = {};
    const document = { visibilityState: 'visible', querySelectorAll: () => [edition],
        createElement: tag => new Element(tag), addEventListener: (type, callback) => { listeners[type] = callback; } };
    const state = { now, requests: [], events: [], pending: new Map(), counter: 0,
        snapshot: snapshot(false), release: { draft: true, published_at: null, assets: [] }, apiStatus: 200 };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/release-downloads.js'), 'utf8'), {
        document, window: { location: { href: 'https://site.test/register/data/', origin: 'https://site.test' } },
        URL, Event, AbortController, Date: { parse: Date.parse, now: () => state.now },
        setTimeout: (callback, delay) => { const id = ++state.counter; state.pending.set(id, { callback, delay }); return id; },
        clearTimeout: id => state.pending.delete(id),
        fetch: async (requestURL, options) => {
            const api = requestURL.startsWith('https://api.github.com/');
            state.requests.push({ url: requestURL, options });
            assert.equal(options.credentials, 'omit');
            if (state.failure) throw new Error('offline');
            return { ok: !api || state.apiStatus === 200, status: api ? state.apiStatus : 200,
                json: async () => api ? state.release : state.snapshot };
        },
    });
    await settle();
    const check = async () => { await listeners.visibilitychange(); await settle(); };
    return { state, edition, cards, status, countdown, document, check };
}

function assertLocked(result) {
    assert.equal(result.edition.dataset.releaseAvailable, 'false');
    assert(result.cards.every(card => card.tagName === 'ARTICLE' && !card.replacement && !card.dataset.goatcounterClick));
}

test('before embargo only same-origin status is checked; local clock alone never unlocks', async () => {
    const early = await setup(deadline - 86400000);
    assertLocked(early);
    assert.equal(early.state.requests.length, 1);
    assert.equal(early.state.requests[0].options.mode, 'same-origin');
    const fastClock = await setup(deadline + 365 * 86400000);
    assertLocked(fastClock);
    assert.equal(fastClock.state.requests.length, 2); // Public API still reports draft.
});

test('a verified same-origin snapshot unlocks all three files in order and adds analytics only then', async () => {
    const result = await setup(deadline - 86400000); // Wrong/slow client clock does not override server verification.
    result.state.snapshot = snapshot(); await result.check();
    assert.equal(result.edition.dataset.releaseAvailable, 'true');
    assert.deepEqual(result.cards.map(card => card.replacement.href), files.map(url));
    result.cards.forEach((card, index) => {
        const link = card.replacement;
        assert.equal(link.tagName, 'A');
        assert.equal(link.download, files[index].filename);
        assert.equal(link.dataset.goatcounterClick, 'download-' + files[index].filename);
        assert.equal(link.dataset.goatcounterNoSession, '1');
        assert.equal(link.querySelector('.release-download-state').textContent, 'Download PDF');
    });
    assert.equal(result.countdown.hidden, true);
    assert.equal(result.state.pending.size, 0);
    assert.deepEqual(result.state.events, ['release:available']);
    const requests = result.state.requests.length; await result.check();
    assert.equal(result.state.requests.length, requests);
});

test('unavailable, premature, mismatched and incomplete snapshots never unlock', async () => {
    for (const change of [
        data => { data.available = false; }, data => { data.checked_at = '2026-10-25T23:54:59Z'; },
        data => { data.release_at = '2026-10-26T00:01:00Z'; }, data => { delete data.documents; },
        data => { data.documents.pop(); }, data => { data.documents[0] = null; }, data => { data.documents[0].size++; },
        data => { data.documents[0].sha256 = 'f'.repeat(64); },
    ]) {
        const result = await setup(deadline - 86400000);
        result.state.snapshot = snapshot(); change(result.state.snapshot); await result.check(); assertLocked(result);
    }
});

test('published API assets unlock an old page while its same-origin status is still unavailable', async () => {
    const result = await setup();
    result.state.release = published(); result.state.now += 300000; await result.check();
    assert.equal(result.edition.dataset.releaseAvailable, 'true');
    assert.equal(result.state.requests.filter(request => request.url.startsWith('https://api.github.com/')).length, 2);
});

test('draft, early publication, wrong tag, missing or tampered assets fail closed', async () => {
    for (const change of [
        data => { data.draft = true; }, data => { data.prerelease = true; }, data => { data.published_at = '2026-10-25T23:54:59Z'; },
        data => { data.tag_name = 'other'; }, data => { data.assets.pop(); }, data => { data.assets[0] = null; },
        data => { data.assets[0].size++; }, data => { delete data.assets[0].digest; },
        data => { data.assets[0].digest = 'sha256:' + 'f'.repeat(64); },
        data => { data.assets[0].browser_download_url = 'https://other.test/file.pdf'; },
        data => { data.assets.push(data.assets[0]); }, data => { data.assets.push({ name: 'unexpected.pdf' }); },
    ]) {
        const result = await setup(); result.state.now += 300000;
        result.state.release = published(); change(result.state.release); await result.check(); assertLocked(result);
    }
});

test('API checks are sparse and rate limiting backs off without hiding the embargo', async () => {
    const result = await setup();
    await result.check();
    assert.equal(result.state.requests.filter(request => request.url.startsWith('https://api.github.com/')).length, 1);
    result.state.now += 300000; result.state.apiStatus = 403; await result.check();
    result.state.now += 300000; result.state.apiStatus = 200; await result.check();
    assert.equal(result.state.requests.filter(request => request.url.startsWith('https://api.github.com/')).length, 2);
    assertLocked(result);
});

test('hidden tabs stop checking; returning checks a new valid status; network errors keep cards locked', async () => {
    const result = await setup(deadline - 86400000);
    result.document.visibilityState = 'hidden'; await result.check();
    assert.equal(result.state.pending.size, 0);
    assert.equal(result.state.requests.length, 1);
    result.document.visibilityState = 'visible'; result.state.failure = true; await result.check(); assertLocked(result);
    result.state.failure = false; result.state.snapshot = snapshot(); await result.check();
    assert.equal(result.edition.dataset.releaseAvailable, 'true');
});


test('checks align to publication and retry the public API promptly for the first three minutes', async () => {
    const result = await setup(deadline - 5000);
    assert.equal([...result.state.pending.values()][0].delay, 5000);
    result.state.now = deadline; await result.check();
    assert.equal([...result.state.pending.values()][0].delay, 30000);
    assert.equal(result.state.requests.filter(request => request.url.startsWith('https://api.github.com/')).length, 1);
    result.state.now += 29999; await result.check();
    assert.equal(result.state.requests.filter(request => request.url.startsWith('https://api.github.com/')).length, 1);
    result.state.now += 1; result.state.release = published(); await result.check();
    assert.equal(result.edition.dataset.releaseAvailable, 'true');
});
