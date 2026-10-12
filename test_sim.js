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
check(ada.inv.food === 4, 'food should be 2+2, got ' + ada.inv.food);

// 2. give/take require co-location, move inventory, notify victim
let bram = s.agents[1];
check(!SIM.applyAction(s, ada, { action: 'take', who: 'Bram', what: 'food', n: 1 }).ok, 'take across map must fail');
SIM.applyAction(s, bram, { action: 'go', place: 'farm' });
bram.inv.food = 1;
let r = SIM.applyAction(s, ada, { action: 'take', who: 'Bram', what: 'food', n: 1 });
check(r.ok, 'co-located take must work: ' + r.text);
check(bram.inv.food === 0 && ada.inv.food === 5, 'inventory transfer failed');
check(bram.needsDecision, 'victim must be notified');
check(bram.memory.some(e => e.text.includes('TOOK')), 'victim memory missing theft');

// 3. eat/drink bounds
ada.hunger = 90; ada.inv.food = 1;
SIM.applyAction(s, ada, { action: 'eat' });
check(ada.hunger === 40, 'eat -50 expected, got ' + ada.hunger);
ada.health = 50; ada.inv.water = 1;
SIM.applyAction(s, ada, { action: 'drink' });
check(ada.health === 65, 'drink +15 expected');

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
check(ada.inv.food >= 4, 'plan should have gathered food');

// 6. failed plan step triggers re-decision
s = SIM.createState();
ada = s.agents[0];
SIM.setPlan(s, ada, [{ action: 'gather_food' }], '', '');
SIM.tick(s);
check(ada.needsDecision, 'failed step must request new decision');
check(s.log.some(e => e.kind === 'fail'), 'failure must be logged');

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
