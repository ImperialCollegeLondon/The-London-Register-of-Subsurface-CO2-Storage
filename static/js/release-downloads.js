// Embargo enforcement lives in the private draft release. This UI only unlocks
// after a server-verified snapshot or the public release API confirms every file.
(() => {
    'use strict';
    document.querySelectorAll('.release-edition[data-release-at]').forEach(edition => {
        if (edition.dataset.releaseAvailable === 'true') return;
        const releaseAt = edition.dataset.releaseAt;
        const deadline = Date.parse(releaseAt);
        const repository = edition.dataset.releaseRepository;
        const tag = edition.dataset.releaseTag;
        const documents = Array.from(edition.querySelectorAll('.release-document')).map(element => ({
            element, filename: element.dataset.documentFilename, size: Number(element.dataset.documentSize),
            sha256: element.dataset.documentSha256, title: element.dataset.documentTitle,
        }));
        if (!Number.isFinite(deadline) || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !tag ||
            !documents.length || new Set(documents.map(item => item.filename)).size !== documents.length ||
            !documents.every(item => item.filename && !/[\\/]/.test(item.filename) &&
                Number.isSafeInteger(item.size) && item.size > 0 && /^[a-f0-9]{64}$/.test(item.sha256))) return;

        const downloadURL = item => 'https://github.com/' + repository + '/releases/download/' +
            encodeURIComponent(tag) + '/' + encodeURIComponent(item.filename);
        const apiURL = 'https://api.github.com/repos/' + repository + '/releases/tags/' + encodeURIComponent(tag);
        const statusURL = new URL(edition.dataset.releaseStatusUrl, window.location.href);
        if (statusURL.origin !== window.location.origin) return;
        let loading = false;
        let timeout;
        let nextApiCheck = 0;

        const snapshotMatches = data => data && data.available === true && data.release_at === releaseAt &&
            Number.isFinite(Date.parse(data.checked_at)) && Date.parse(data.checked_at) >= deadline &&
            Array.isArray(data.documents) && data.documents.length === documents.length &&
            documents.every(expected => {
                const matching = data.documents.filter(item => item && item.filename === expected.filename);
                return matching.length === 1 && matching[0].size === expected.size && matching[0].sha256 === expected.sha256;
            });
        const releaseMatches = data => data && data.draft === false && data.prerelease === false && data.tag_name === tag &&
            Number.isFinite(Date.parse(data.published_at)) && Date.parse(data.published_at) >= deadline &&
            Array.isArray(data.assets) && data.assets.length === documents.length && documents.every(expected => {
                const matching = data.assets.filter(item => item && item.name === expected.filename);
                return matching.length === 1 && matching[0].state === 'uploaded' && matching[0].size === expected.size &&
                    matching[0].digest === 'sha256:' + expected.sha256 && matching[0].browser_download_url === downloadURL(expected);
            });
        const unlock = () => {
            documents.forEach(item => {
                const link = document.createElement('a');
                for (const attribute of Array.from(item.element.attributes)) link.setAttribute(attribute.name, attribute.value);
                link.classList.remove('is-embargoed');
                link.href = downloadURL(item);
                link.download = item.filename;
                link.dataset.goatcounterNoSession = '1';
                link.dataset.goatcounterClick = 'download-' + item.filename;
                link.dataset.goatcounterTitle = item.title;
                while (item.element.firstChild) link.appendChild(item.element.firstChild);
                link.querySelector('.release-download-state').textContent = 'Download PDF';
                item.element.replaceWith(link);
            });
            edition.dataset.releaseAvailable = 'true';
            const countdown = edition.querySelector('.release-countdown');
            if (countdown) countdown.hidden = true;
            const status = edition.querySelector('.release-countdown-status');
            if (status) {
                status.textContent = 'The 2026 materials are now available.';
                status.hidden = false;
            }
            const prefix = edition.querySelector('.release-announcement-prefix');
            if (prefix) prefix.textContent = 'Publication time: ';
            edition.dispatchEvent(new Event('release:available'));
            clearTimeout(timeout);
        };
        const getJSON = async (url, api = false) => {
            const controller = new AbortController();
            const requestTimeout = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(url, {
                    cache: 'no-store', credentials: 'omit', mode: api ? 'cors' : 'same-origin',
                    signal: controller.signal,
                    ...(api ? { headers: { Accept: 'application/vnd.github+json' } } : {}),
                });
                if (!response.ok) {
                    if (api && (response.status === 403 || response.status === 429)) {
                        nextApiCheck = Date.now() + 30 * 60 * 1000;
                    }
                    return null;
                }
                return await response.json();
            } catch (_) {
                return null;
            } finally {
                clearTimeout(requestTimeout);
            }
        };
        const check = async () => {
            clearTimeout(timeout);
            if (loading || document.visibilityState === 'hidden' || edition.dataset.releaseAvailable === 'true') return;
            loading = true;
            try {
                if (snapshotMatches(await getJSON(statusURL.href))) {
                    unlock();
                    return;
                }
                // Client time only controls polling frequency. It never unlocks links.
                // A slow/incorrect clock can still use a verified same-origin status.
                if (Date.now() >= deadline && Date.now() >= nextApiCheck) {
                    nextApiCheck = Date.now() + (Date.now() - deadline < 3 * 60 * 1000 ? 30 * 1000 : 5 * 60 * 1000);
                    if (releaseMatches(await getJSON(apiURL, true))) unlock();
                }
            } finally {
                loading = false;
                if (edition.dataset.releaseAvailable !== 'true' && document.visibilityState !== 'hidden') {
                    const untilRelease = deadline - Date.now();
                    const delay = untilRelease > 10 * 60 * 1000 ?
                        Math.min(15 * 60 * 1000, untilRelease - 10 * 60 * 1000) :
                        untilRelease > 0 ? Math.min(60 * 1000, untilRelease) :
                        untilRelease > -3 * 60 * 1000 ? 30 * 1000 : 60 * 1000;
                    timeout = setTimeout(check, delay);
                }
            }
        };
        check();
        document.addEventListener('visibilitychange', check);
    });
})();
