import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/shared/guest.js', import.meta.url), 'utf8');
const key = 'wedding-games:v1';
function createGuest({ saved = null, blocked = false, quota = false } = {}) {
  const storage = new Map(saved ? [[key, saved]] : []);
  const context = vm.createContext({
    window: {},
    localStorage: {
      getItem(k) { if (blocked) throw new Error('blocked'); return storage.get(k) ?? null; },
      setItem(k, v) { if (blocked || quota) throw new Error('quota'); storage.set(k, v); }
    }
  });
  vm.runInContext(source, context);
  return { guest: context.window.WeddingGuest, storage };
}
test('nickname and each game best persist independently across reloads', () => {
  const { guest, storage } = createGuest();
  assert.equal(guest.setName('  小林  '), '小林');
  guest.recordResult('jump', { score: 12, won: true });
  guest.recordResult('jump', { score: 4 });
  guest.recordResult('boss', { score: 400 });
  const reloaded = createGuest({ saved: storage.get(key) }).guest;
  assert.equal(reloaded.getName(), '小林');
  assert.equal(reloaded.getBest('jump'), 12);
  assert.equal(reloaded.getBest('boss'), 400);
});
test('blocked storage and invalid JSON do not stop play', () => {
  for (const options of [{ blocked: true }, { saved: '{bad' }]) {
    const { guest } = createGuest(options);
    guest.setName('宾客');
    guest.recordResult('boss', { score: 150 });
    assert.equal(guest.getName(), '宾客');
    assert.equal(guest.getBest('boss'), 150);
  }
});
test('quota failures retain new in-memory data instead of rereading an old snapshot', () => {
  const { guest } = createGuest({ quota: true, saved: JSON.stringify({ name: '旧昵称', results: { jump: { best: 5 } } }) });
  guest.setName('新昵称');
  guest.recordResult('jump', { score: 20 });
  assert.equal(guest.getName(), '新昵称');
  assert.equal(guest.getBest('jump'), 20);
  assert.equal(guest.isPersistent(), false);
});
test('malformed stored values and invalid scores stay bounded', () => {
  const { guest } = createGuest({ saved: JSON.stringify({ name: {}, results: { jump: { best: 'Infinity', plays: -1 }, boss: null } }) });
  assert.equal(guest.getName(), '');
  assert.equal(guest.getBest('jump'), 0);
  guest.recordResult('jump', { score: NaN });
  guest.recordResult('boss', { score: -10 });
  guest.recordResult('__proto__', { score: 200 });
  assert.equal(guest.getBest('jump'), 0);
  assert.equal(guest.getBest('boss'), 0);
  assert.equal(guest.getBest('__proto__'), 0);
  assert.equal(guest.setName('123456789012345\n'), '123456789012');
});
