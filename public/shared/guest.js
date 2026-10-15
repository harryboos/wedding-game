(function () {
  'use strict';
  const KEY = 'wedding-games:v1';
  const games = new Set(['jump', 'boss']);
  let memory = { name: '', results: {} };
  let persistent = true;
  const cleanName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12) : '';
  const cleanScore = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  function read() {
    // A failed write must not let an older stored snapshot replace this page's data.
    if (!persistent) return memory;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const results = {};
        for (const game of games) {
          const result = saved.results?.[game];
          if (result && typeof result === 'object') {
            results[game] = { best: cleanScore(result.best), plays: cleanScore(result.plays), lastScore: cleanScore(result.lastScore), won: result.won === true };
          }
        }
        memory = { name: cleanName(saved.name), results };
      }
    } catch (_) { persistent = false; }
    return memory;
  }

  function write(data) {
    memory = data;
    try { localStorage.setItem(KEY, JSON.stringify(data)); persistent = true; }
    catch (_) { persistent = false; }
  }

  window.WeddingGuest = Object.freeze({
    getName() { return read().name; },
    setName(name) { const data = read(); data.name = cleanName(name); write(data); return data.name; },
    getBest(game) { return games.has(game) ? read().results[game]?.best || 0 : 0; },
    recordResult(game, result = {}) {
      if (!games.has(game)) return;
      const data = read();
      const previous = data.results[game] || { best: 0, plays: 0 };
      const score = cleanScore(result.score);
      data.results[game] = { best: Math.max(previous.best, score), plays: previous.plays + 1, lastScore: score, won: result.won === true };
      write(data);
    },
    isPersistent() { return persistent; }
  });
})();
