/**
 * First-visit welcome: after "Who's watching?", point new visitors at the three things
 * that make SparkFlix different. Shown once per device; never shown to someone who
 * arrived through a Watch Party invite link (they're already in the middle of something).
 */
'use strict';

const Welcome = (() => {
  const SEEN_KEY = 'sparkflix:welcomed';
  const el = (id) => document.getElementById(id);

  function show() {
    el('welcome-modal').hidden = false;
    document.body.classList.add('modal-open');
    el('welcome-start').focus({ preventScroll: true });
  }

  function hide() {
    el('welcome-modal').hidden = true;
    document.body.classList.remove('modal-open');
    storage.set(SEEN_KEY, true);
  }

  function go(target) {
    hide();
    if (target === 'party') switchView('party');
    else if (target === 'live') switchView('live');
    else if (target === 'taste') {
      switchView('home');
      const rail = el('rail-taste-picker');
      if (rail && rail.hidden) el('taste-edit-btn').click();
      setTimeout(() => el('rail-taste-picker').scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }

  function init() {
    el('welcome-start').addEventListener('click', hide);
    document.querySelectorAll('[data-welcome]').forEach((b) => b.addEventListener('click', () => go(b.dataset.welcome)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el('welcome-modal').hidden) hide();
    });

    const invited = new URLSearchParams(location.search).has('party');
    if (storage.get(SEEN_KEY, false) || invited) return;

    // Wait until the profile picker is dismissed, then welcome them
    const gate = el('profile-gate');
    if (gate.hidden) {
      setTimeout(show, 600);
      return;
    }
    const obs = new MutationObserver(() => {
      if (gate.hidden) {
        obs.disconnect();
        setTimeout(show, 350);
      }
    });
    obs.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  }

  return { init, show };
})();

document.addEventListener('DOMContentLoaded', Welcome.init);
