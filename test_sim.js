// Headless check for the sim core embedded in index.html.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
const m = src.match(/<script id="sim">([\s\S]*?)<\/script>/);
if (!m) throw new Error('sim block not found in index.html');
const mod = { exports: {} };
new Function('module', m[1])(mod);
const SIM = mod.exports;

const seen = new Set();
function run(seed, n) {
  const s = SIM.createState(seed);
  for (let i = 0; i < n; i++) {
    SIM.tick(s);
    for (const a of s.agents) seen.add(a.act);
  }
  return s;
}

function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const s = run(42, 1500);
for (const a of s.agents) {
  check(a.hx >= 0 && a.hx <= 100, a.name + ' hunger out of range');
  check(a.en >= 0 && a.en <= 100, a.name + ' energy out of range');
  check(Number.isFinite(a.money) && a.money >= 0, a.name + ' money invalid');
  check(Number.isFinite(a.x) && a.x >= 0 && a.x <= 16, a.name + ' position invalid');
}
check(s.food >= 0, 'food went negative');
check(seen.has('eat') && seen.has('sleep') && seen.has('work') && seen.has('wander'),
  'missing actions: ' + [...seen]);
check(s.stats.foodMade > 10, 'economy produced no food: ' + s.stats.foodMade);
check(s.stats.foodEaten > 10, 'nobody ate: ' + s.stats.foodEaten);
check(s.stats.moneyMade > 10, 'no money earned: ' + s.stats.moneyMade);

// determinism: same seed -> identical state
const s2 = run(42, 1500);
check(JSON.stringify(s1z(s)) === JSON.stringify(s1z(s2)), 'non-deterministic run');
function s1z(x) { const c = Object.assign({}, x); delete c.rnd; return c; }

console.log('ok  ticks=' + s.t, 'food=' + s.food,
  'stats=' + JSON.stringify(s.stats), 'actions=' + [...seen].join(','));
