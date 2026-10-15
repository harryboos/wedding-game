(function () {
  'use strict';
  const guest = window.WeddingGuest;
  const input = document.getElementById('guest-name');
  const status = document.getElementById('guest-status');
  function refresh() {
    if (document.activeElement !== input) input.value = guest.getName();
    for (const game of ['jump', 'boss']) {
      const best = guest.getBest(game);
      document.getElementById(game + '-best').textContent = best > 0 ? '本机最佳 ' + best.toLocaleString('zh-CN') + ' 分' : '等你来挑战';
    }
  }
  function saveName() {
    const name = guest.setName(input.value);
    input.value = name;
    status.textContent = guest.isPersistent() ? (name ? '已保存，' + name + '，玩得开心！' : '不填也可以直接开始') : '浏览器未允许保存，进入游戏后可填写昵称';
  }
  document.getElementById('guest-form').addEventListener('submit', event => { event.preventDefault(); saveName(); });
  document.querySelectorAll('[data-game]').forEach(link => link.addEventListener('click', saveName));
  window.addEventListener('pageshow', refresh);
  window.addEventListener('storage', refresh);
  refresh();
})();
