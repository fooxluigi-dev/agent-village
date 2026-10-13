// Headless checks for the engine embedded in index.html.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
const m = src.match(/<script id="sim">([\s\S]*?)<\/script>/);
if (!m) throw new Error('sim block not found');
const mod = { exports: {} };
new Function('module', m[1])(mod);
const SIM = mod.exports;

function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

// 1. action validation: gather needs location + stock
let s = SIM.createState();
let ada = s.agents[0];
check(!SIM.applyAction(s, ada, { action: 'gather_food' }).ok, 'gather away from farm must fail');
SIM.applyAction(s, ada, { action: 'go', place: 'farm' });
check(SIM.applyAction(s, ada, { action: 'gather_food' }).ok, 'gather at farm must work');
check(ada.inv.food === 5, 'food should be 2+3, got ' + ada.inv.food);

// 2. give/take require co-location, move inventory, notify victim
let bram = s.agents[1];
check(!SIM.applyAction(s, ada, { action: 'take', who: 'Bram', what: 'food', n: 1 }).ok, 'take across map must fail');
SIM.applyAction(s, bram, { action: 'go', place: 'farm' });
bram.inv.food = 1;
let r = SIM.applyAction(s, ada, { action: 'take', who: 'Bram', what: 'food', n: 1 });
check(r.ok, 'co-located take must work: ' + r.text);
check(bram.inv.food === 0 && ada.inv.food === 6, 'inventory transfer failed');
check(bram.needsDecision, 'victim must be notified');
check(bram.memory.some(e => e.text.includes('TOOK')), 'victim memory missing theft');

// 3. eat/drink bounds
ada.hunger = 90; ada.inv.food = 1;
SIM.applyAction(s, ada, { action: 'eat' });
check(ada.hunger === 20, 'eat -70 expected, got ' + ada.hunger);
ada.health = 50; ada.inv.water = 1;
SIM.applyAction(s, ada, { action: 'drink' });
check(ada.health === 65, 'drink +15 expected');

// 3b. till/create: cost from NODE stock, till lv+1 (6h), create tiles+1 (24h), paid on final hour
s = SIM.createState();
ada = s.agents[0];
check(!SIM.applyAction(s, ada, { action: 'till' }).ok, 'till at camp must fail (no node)');
SIM.applyAction(s, ada, { action: 'go', place: 'farm' });
s.nodes.wood.stock = 3;
check(!SIM.applyAction(s, ada, { action: 'till' }).ok, 'till must fail fast when node stock is low');
s.nodes.wood.stock = 20; s.nodes.wood.max = 20; s.nodes.water.stock = 20; s.nodes.water.max = 20;  // max=stock blocks regen noise
SIM.setPlan(s, ada, [{ action: 'till' }], 't', 'g');
for (let i = 0; i < 6; i++) SIM.tick(s);
check(s.nodes.food.level === 2, 'till must apply once after 6h, level ' + s.nodes.food.level);
check(s.nodes.wood.stock === 14 && s.nodes.water.stock === 14, 'till must pay 6+6 ONCE, wood ' + s.nodes.wood.stock + ' water ' + s.nodes.water.stock);
s.nodes.wood.stock = 50; s.nodes.water.stock = 50;
ada.hunger = 0; ada.health = 100;  // the agent must eat BEFORE a 24h job — hunger won't abort it but will hurt
SIM.setPlan(s, ada, [{ action: 'create' }], 't', 'g');
for (let i = 0; i < 24; i++) SIM.tick(s);
check(s.nodes.food.tiles === 2, 'create adds a tile after 24h even with hunger');
check(ada.health < 100 && ada.hunger === 100, '24h job on full hunger must cost real health, got ' + ada.health);
check(s.nodes.wood.stock === 8 && s.nodes.water.stock === 8, 'create must pay 42+42 ONCE, wood ' + s.nodes.wood.stock);
// interrupted create: no tile, no payment
s.nodes.wood.stock = 50; s.nodes.water.stock = 50;
ada.health = 25;  // low health interrupts EVERYTHING, work included
SIM.setPlan(s, ada, [{ action: 'create' }], 't', 'g');
for (let i = 0; i < 3; i++) SIM.tick(s);
check(s.nodes.food.tiles === 2 && s.nodes.wood.stock === 50, 'interrupted create must pay nothing');

// regen: 2 tiles lv2 = +4/4h
s.nodes.food.stock = 10; s.h = 3;
for (let i = 0; i < 4; i++) SIM.tick(s);
check(s.nodes.food.stock === 14, '2 tiles lv2 must regen +4, got ' + (s.nodes.food.stock - 10));

// 4. tick: vitals advance, clock 1h, starvation death, death notifies nearby
s = SIM.createState();
for (let i = 0; i < 40; i++) SIM.tick(s);
check(s.h === 40, 'clock must be 40h, got ' + s.h);
check(s.agents.some(a => !a.alive), 'nobody died in 40h with no food');
let dead = s.agents.find(a => !a.alive);
let bystander = s.agents.find(a => a.alive && a.loc === dead.loc);
if (bystander) check(bystander.memory.some(e => e.text.includes('DIED')), 'bystander must learn of death');

// 5. plan lifecycle: setPlan executes step-by-step, ends with needsDecision
s = SIM.createState();
ada = s.agents[0];
SIM.setPlan(s, ada, [{ action: 'go', place: 'farm' }, { action: 'gather_food', hours: 2 }], 't', 'g');
check(!ada.needsDecision && ada.plan.length === 2, 'plan must be active');
for (let i = 0; i < 4; i++) SIM.tick(s);
check(ada.plan.length === 0 && ada.needsDecision, 'plan must finish and re-request decision');
check(ada.inv.food >= 5, 'plan should have gathered food');

// 6. failed plan step triggers re-decision
s = SIM.createState();
ada = s.agents[0];
SIM.setPlan(s, ada, [{ action: 'gather_food' }], '', '');
SIM.tick(s);
check(ada.needsDecision, 'failed step must request new decision');
check(s.log.some(e => e.kind === 'fail'), 'failure must be logged');

// 6b. an LLM plan with no valid steps must NOT leave the agent catatonic
s = SIM.createState();
ada = s.agents[0];
SIM.setPlan(s, ada, [{ nope: 1 }, { action: 42 }, {}], 'bad plan', 'g');
check(ada.plan.length > 0, 'invalid LLM plan must fall back to local brain');
check(!ada.needsDecision && ada.status !== 'idle' || ada.status === 'idle',
  'agent must have an executable plan');
SIM.tick(s);
check(s.log.some(e => e.text.includes('no valid steps')), 'fallback must be logged');

// 7. local brain never breaks invariants (72h smoke, all agents)
s = SIM.createState();
for (let h = 0; h < 72; h++) {
  for (const a of s.agents) {
    if (a.alive && a.needsDecision) SIM.setPlan(s, a, SIM.localBrain(s, a), 'local', 'survive');
  }
  SIM.tick(s);
}
for (const a of s.agents) {
  check(a.hunger >= 0 && a.hunger <= 100 && a.energy >= 0 && a.energy <= 100 && a.health >= 0 && a.health <= 100,
    a.name + ' vitals out of range');
  check(Object.values(a.inv).every(v => v >= 0), a.name + ' negative inventory');
}
check(s.log.every(e => ['decision', 'event', 'fail', 'death', 'local'].includes(e.kind)), 'unknown log kind');

console.log('ok  engine checks passed · survivors=' + s.agents.filter(a => a.alive).length +
  '/3 after 72h local · log=' + s.log.length);
