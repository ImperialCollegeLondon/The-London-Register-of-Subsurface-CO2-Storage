// AoE is UTC-12. The <time datetime> supplies the absolute publication instant.
(() => {
    'use strict';
    document.querySelectorAll('.release-countdown[data-release-time]').forEach(timer => {
        const time = document.getElementById(timer.dataset.releaseTime);
        const deadline = time && Date.parse(time.dateTime);
        if (!Number.isFinite(deadline)) return;
        const parent = timer.closest('.downloads-placeholder');
        const status = parent.querySelector('.release-countdown-status');
        const units = Array.from(timer.querySelectorAll('[data-unit]'));
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let timeout;
        let initialized = false;

        units.forEach(unit => {
            unit.querySelector('.release-flip-card').addEventListener('animationend', event => {
                if (event.target.classList.contains('release-flip-bottom')) {
                    event.currentTarget.classList.remove('is-flipping');
                }
            });
        });
        const tick = () => {
            clearTimeout(timeout);
            if (document.visibilityState === 'hidden') return;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                timer.hidden = true;
                parent.querySelector('.release-announcement-prefix').textContent = 'Scheduled publication: ';
                status.textContent = 'The scheduled publication time has arrived. Please check this page for the 2026 materials.';
                status.hidden = false;
                return;
            }
            // Ceil prevents showing all zeroes before the actual release instant.
            const seconds = Math.ceil(remaining / 1000);
            const values = {
                days: Math.floor(seconds / 86400),
                hours: Math.floor(seconds / 3600) % 24,
                minutes: Math.floor(seconds / 60) % 60,
                seconds: seconds % 60,
            };
            units.forEach(unit => {
                const value = String(values[unit.dataset.unit]).padStart(2, '0');
                const card = unit.querySelector('.release-flip-card');
                const current = card.querySelector('.release-flip-value');
                if (current.textContent === value) return;
                card.classList.remove('is-flipping');
                card.querySelector('.release-flip-previous').textContent = current.textContent;
                card.querySelector('.release-flip-top').textContent = current.textContent;
                card.querySelector('.release-flip-bottom').textContent = value;
                current.textContent = value;
                if (initialized && !reducedMotion.matches) {
                    void card.offsetWidth;
                    card.classList.add('is-flipping');
                }
            });
            timer.setAttribute('aria-label', Object.entries(values).map(([unit, value]) =>
                value + ' ' + (value === 1 ? unit.slice(0, -1) : unit)).join(', ') + ' until the scheduled 2026 publication.');
            timer.hidden = false;
            status.hidden = true;
            initialized = true;
            // Recompute from wall-clock time after each tick and when returning to a tab.
            timeout = setTimeout(tick, Math.max(20, remaining % 1000 || 1000));
        };
        tick();
        document.addEventListener('visibilitychange', tick);
    });
})();
