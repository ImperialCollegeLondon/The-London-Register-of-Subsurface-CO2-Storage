// Read only the public snapshot published by Hugo; never infer counts from clicks.
(() => {
    'use strict';
    const footer = document.querySelector('.footer-stats[data-stats-url]');
    if (!footer) return;
    const counters = Array.from(footer.querySelectorAll('[data-stat-key]'));
    const countries = Array.from(footer.querySelectorAll('[data-country]'));
    const format = new Intl.NumberFormat('en-GB');
    const countIsValid = value => Number.isSafeInteger(value) && value >= 0;
    let loading = false;

    const refresh = async () => {
        if (loading || document.visibilityState === 'hidden') return;
        loading = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(footer.dataset.statsUrl, {
                cache: 'no-store', mode: 'same-origin', signal: controller.signal,
            });
            if (!response.ok) return;
            const data = await response.json();
            if (!data || data.version !== 1 || data.available !== true ||
                !/^\d{4}-\d{2}-\d{2}$/.test(data.start) ||
                !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(data.generated) ||
                data.generated < footer.dataset.statsGenerated ||
                typeof data.has_countries !== 'boolean' || !data.counts || !data.countries ||
                !counters.every(element => countIsValid(data.counts[element.dataset.statKey])) ||
                !countries.every(element => countIsValid(data.countries[element.dataset.country]))) return;

            // Validate the whole snapshot before changing any displayed number.
            counters.forEach(element => {
                element.textContent = format.format(data.counts[element.dataset.statKey]);
            });
            countries.forEach(element => {
                const name = element.dataset.country;
                const count = data.countries[name];
                const level = count >= 100 ? 'high' : count >= 10 ? 'medium' : count > 0 ? 'low' : 'none';
                element.dataset.count = String(count);
                element.setAttribute('class', 'visitor-country visits-' + level);
                element.querySelector('title').textContent = name + ': ' + count + ' recorded visits';
            });
            footer.querySelector('.stats-updated').textContent =
                'Recorded activity since ' + data.start + '. Updated ' + data.generated + '. Updates approximately every 15 minutes.';
            footer.dataset.statsGenerated = data.generated;
            let note = footer.querySelector('.stats-note');
            if (!data.has_countries && !note) {
                note = document.createElement('p');
                note.className = 'stats-note';
                footer.querySelector('.stat-map').appendChild(note);
            }
            if (note) {
                note.hidden = data.has_countries;
                note.textContent = 'No country visits recorded in this period.';
            }
        } catch (_) {
            // Keep the last valid displayed values if offline or a response is incomplete.
        } finally {
            clearTimeout(timeout);
            loading = false;
        }
    };
    refresh();
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
})();
