// Use the rendered country titles for touch, mouse and keyboard inspection.
(() => {
    'use strict';
    const map = document.getElementById('visitor-map');
    if (!map) return;
    const canvas = map.closest('.visitor-map-canvas');
    const tooltip = canvas && canvas.querySelector('.visitor-map-tooltip');
    const countries = Array.from(map.querySelectorAll('[data-country]'));
    if (!tooltip || !countries.length) return;
    const hint = canvas.parentElement.querySelector('.visitor-map-hint');
    let active = null;
    let pinned = false;
    let tabStop = countries.find(country => Number(country.dataset.count) > 0) || countries[0];

    const label = country => country.querySelector('title').textContent;
    const show = (country, persist) => {
        if (active && active !== country) active.removeAttribute('data-selected');
        tabStop.setAttribute('tabindex', '-1');
        tabStop = country;
        tabStop.setAttribute('tabindex', '0');
        active = country;
        pinned = persist;
        country.setAttribute('data-selected', 'true');
        tooltip.textContent = label(country);
        tooltip.hidden = false;
    };
    const hide = () => {
        if (active) active.removeAttribute('data-selected');
        active = null;
        pinned = false;
        tooltip.hidden = true;
        tooltip.textContent = '';
    };
    const countryAt = event => {
        const country = event.target.closest('[data-country]');
        return country && map.contains(country) ? country : null;
    };
    countries.forEach(country => {
        country.setAttribute('role', 'button');
        country.setAttribute('tabindex', country === tabStop ? '0' : '-1');
        country.setAttribute('aria-label', label(country));
    });
    map.setAttribute('role', 'group');
    map.querySelector('desc').textContent =
        'Countries are shaded by recorded visits. Tap or hover to see a count. Use arrow keys to move between countries, or Escape to dismiss.';
    if (hint) hint.hidden = false;

    map.addEventListener('click', event => {
        const country = countryAt(event);
        if (country) show(country, true);
        else hide();
    });
    map.addEventListener('pointerover', event => {
        if (event.pointerType === 'touch') return;
        const country = countryAt(event);
        if (country) show(country, false);
    });
    canvas.addEventListener('pointerleave', () => { if (!pinned) hide(); });
    map.addEventListener('focusin', event => {
        const country = countryAt(event);
        if (country) show(country, true);
    });
    map.addEventListener('focusout', event => { if (!map.contains(event.relatedTarget)) hide(); });
    map.addEventListener('keydown', event => {
        const country = countryAt(event);
        if (!country) return;
        const index = countries.indexOf(country);
        let next;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = countries[(index + 1) % countries.length];
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = countries[(index + countries.length - 1) % countries.length];
        else if (event.key === 'Home') next = countries[0];
        else if (event.key === 'End') next = countries[countries.length - 1];
        else if (event.key === 'Enter' || event.key === ' ') show(country, true);
        else if (event.key === 'Escape') hide();
        else return;
        event.preventDefault();
        if (next) {
            show(next, true);
            next.focus({ preventScroll: true });
        }
    });
    document.addEventListener('click', event => { if (!canvas.contains(event.target)) hide(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) hide(); });

    // The refresh script updates these titles only after validating a full snapshot.
    new MutationObserver(() => {
        countries.forEach(country => country.setAttribute('aria-label', label(country)));
        if (active) tooltip.textContent = label(active);
    }).observe(map, { childList: true, characterData: true, subtree: true });
})();
