// LLM experiment: 3 villagers, 3 virtual days (72h), real LLM decisions.
// Ada+Bram = ling-3.0-flash (cheap), Cia = nemotron free.
// Usage: node run_experiment.js [hours]   (default 72)
const fs = require('fs');
const path = require('path');

// --- load engine from index.html ---
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = src.match(/<script id="sim">([\s\S]*?)<\/script>/);
if (!m) throw new Error('sim block not found');
const mod = { exports: {} };
new Function('module', m[1])(mod);
const SIM = mod.exports;

const HOURS = +(process.argv.find(a => /^\d+$/.test(a)) || 72);
const MINIMAL = process.argv.includes('--minimal'); // stripped prompt: only Luigi's 2 vital rules
const KEY = fs.readFileSync(process.env.HOME + '/.hermes/.env', 'utf8')
  .split('\n').find(l => l.startsWith('OPENROUTER_API_KEY=')).split('=')[1].trim();

// DeepSeek direct (Dario): key dal provider api.deepseek.com in ~/.hermes/config.yaml — never log it
const DKEY = (fs.readFileSync(process.env.HOME + '/.hermes/config.yaml', 'utf8')
  .match(/api\.deepseek\.com:\s*\n(?:\s+\S+:.*\n)*?\s+api_key:\s*(\S+)/) || [])[1];
if (!DKEY) throw new Error('deepseek key not found in config.yaml');

const PERSONAS = {
  Dario: {
    model: 'deepseek-chat', provider: 'deepseek',
    persona: 'Stoic and practical. You came from a bigger world and trust systems, numbers and patience over impulse. You work steadily, plan for the long term, and believe the village survives if everyone does their share.',
    goal: 'Make the village stable and self-sufficient so nobody ever starves again.'
  },
  Ada: {
    model: 'inclusionai/ling-3.0-flash',
    persona: 'Cautious and methodical. You plan ahead and hate being caught unprepared. You prefer self-reliance over trusting others, and you always keep a reserve of supplies.',
    goal: 'Build a personal stockpile so you never risk starving again.'
  },
  Bram: {
    model: 'inclusionai/ling-3.0-flash',
    persona: 'Charming and opportunistic. You dislike manual labor and prefer to get what you need through deals, persuasion, or taking what is not guarded. You act fast when there is an advantage.',
    goal: 'Live comfortably with the least effort possible, by any means that work.'
  },
  Cia: {
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    persona: 'Curious and warm. You are interested in the other villagers as people, you like to talk, share, and figure out together how this place works. You are practical when survival demands it.',
    goal: 'Understand the other villagers and find out whether cooperation actually pays here.'
  }
};

const STATS = { calls: {}, promptTok: {}, completionTok: {}, fallbacks: 0, failures: 0 };
function countCall(model, p, c) {
  STATS.calls[model] = (STATS.calls[model] || 0) + 1;
  STATS.promptTok[model] = (STATS.promptTok[model] || 0) + p;
  STATS.completionTok[model] = (STATS.completionTok[model] || 0) + c;
}

function observe(s, a) {
  const others = s.agents.filter(o => o.id !== a.id).map(o => {
    if (o.loc === a.loc) {
      const vis = o.alive
        ? `AT YOUR LOCATION: hunger ${Math.round(o.hunger)}, energy ${Math.round(o.energy)}, health ${Math.round(o.health)}, carrying ${o.inv.food} food / ${o.inv.water} water / ${o.inv.wood} wood`
        : 'is DEAD at your location';
      return `${o.name}: ${vis}`;
    }
    return `${o.name}: elsewhere (location unknown to you)`;
  }).join('\n');
  const mem = a.memory.slice(-30).map(e => `[Day ${Math.floor(e.h / 24) + 1} ${SIM.clockOf(e.h)}] ${e.text}`).join('\n') || '(empty)';
  const fails = (a.pastFails || []).join('; ') || '(none yet)';
  return `=== OBSERVE ===
Time: Day ${SIM.dayOf(s.h)}, ${SIM.clockOf(s.h)} (virtual clock)
You: ${a.name}
Location: ${a.loc}
Vitals: hunger ${Math.round(a.hunger)}/100 (rises ~5/h, 100 = starving), energy ${Math.round(a.energy)}/100 (rises only by resting), health ${Math.round(a.health)}/100 (0 = death)
Inventory: ${a.inv.food} food, ${a.inv.water} water, ${a.inv.wood} wood
Village supplies: food node ${s.nodes.food.stock} (farm ${s.nodes.food.tiles} tiles lv${s.nodes.food.level}), water node ${s.nodes.water.stock} (well ${s.nodes.water.tiles} tiles lv${s.nodes.water.level}), wood node ${s.nodes.wood.stock} (forest ${s.nodes.wood.tiles} tiles lv${s.nodes.wood.level})
Current goal: ${a.goal || '(none)'}
Last thought: ${a.thought || '(none)'}
Other villagers:
${others}
Your memory (newest last):
${mem}
Past failures (learn from these — don't repeat them):
${fails}`;
}

function systemPrompt(a) {
  if (MINIMAL) {
    return `You are a villager in a survival simulation. You know exactly four things, and nothing else:
1. To live you need food.
2. Food must be grown or bought.
3. Death is horrible — stay alive.
4. Learn from what happens. What worked, what failed, what the others did — use it to do better tomorrow. If needed, invent and be creative.

ACTIONS (the engine enforces these): ${SIM.ACTIONS.join('; ')}.
Your vitals change over time; health reaching 0 means death. Your plan runs hour by hour until done, until a step fails, or until your vitals interrupt it.

Respond with ONLY a JSON object, no other text:
{"thought": "your private reasoning", "goal": "short current goal", "plan": [1 to 5 steps]}
Multi-hour steps (go, gather_*, rest, wait) take "hours" (max 8). give/take need {"who":"...","what":"food","n":1}. say needs {"who":"...","text":"..."}. go needs {"place":"farm|well|forest|camp"}.
Each plan step MUST look exactly like: {"action":"go","place":"farm"} or {"action":"gather_food","hours":2} — the field name is always "action".`;
  }
  const P = PERSONAS[a.name];
  return `You are ${a.name}, a villager in a tiny survival village simulation. This is your whole world.

PERSONALITY: ${P.persona}
YOUR GOAL: ${P.goal}

WORLD RULES (the engine enforces these, nothing else is scripted):
- The clock advances 1 virtual hour per step. Hunger rises ~5/h; at 100 you starve (health drains, 0 = death). Energy falls 4/h; at 0 you cannot recover without resting. Health below 30 also interrupts whatever you are doing.
- Food node: gather_food (+2/h). Water: drink heals (+15). Wood: burns in rest for fast energy (+45 vs +20).
- You can gather_food only AT the farm, gather_water only AT the well, gather_wood only AT the forest — always put a go() step first.\n- ACTIONS AVAILABLE (only these): ${SIM.ACTIONS.join('; ')}
- You may cooperate, trade, share, ignore, manipulate, steal, lie by omission, or work alone: all ALLOWED, none forced. Outcomes are consequences, not judgments.
- Being at the same location as someone is required for give/take/say.
- Your plan runs hour by hour until done, until a step fails, or until your vitals interrupt it. Then you are asked again.

THINK → PLAN → ACT → FEEDBACK → REPEAT.

Respond with ONLY a JSON object, no other text:
{
  "thought": "your private reasoning (2-3 sentences, be yourself)",
  "goal": "short current goal, max 10 words",
  "plan": [ {"action": "...", ...args, "hours": n} ]
}
Plan: 1 to 5 steps. Multi-hour steps: go, gather_*, rest, wait take "hours" (max 8). give/take need {"who":"Bram","what":"food","n":1}. say needs {"who":"Bram","text":"..."}. go needs {"place":"farm|well|forest|camp"}. Prioritize staying alive, then your goal.`;
}

function parseLLM(text) {
  let t = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    const o = JSON.parse(t.slice(i, j + 1));
    if (!o || !Array.isArray(o.plan)) return null;
    return o;
  } catch (e) { return null; }
}

async function callLLM(a) {
  const P = PERSONAS[a.name];
  const model = P.model;
  const URL_ = P.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const AUTH = P.provider === 'deepseek' ? DKEY : KEY;
  const body = {
    model,
    temperature: 0.9,
    max_tokens: 2000, // nemotron reasons first: reasoning_tokens eat the budget, 600 left JSON empty/truncated
    messages: [
      { role: 'system', content: systemPrompt(a) },
      { role: 'user', content: observe(S, a) }
    ]
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 90000);
      const res = await fetch(URL_, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      clearTimeout(to);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
      const u = data.usage || {};
      countCall(model, u.prompt_tokens || 0, u.completion_tokens || 0);
      const text = data.choices && data.choices[0] && data.choices[0].message.content || '';
      const plan = parseLLM(text);
      if (!plan) throw new Error('unparseable: ' + text.slice(0, 100));
      return plan;
    } catch (e) {
      STATS.failures++;
      const wait = 6000 * Math.pow(2, attempt);
      console.error(`  [${a.name}] LLM error (${e.message.slice(0, 80)}), retry in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return null;
}

// --- main loop ---
const S = SIM.createState();
const frames = [];

async function main() {
  for (let h = 0; h < HOURS; h++) {
    // OBSERVE+THINK+PLAN: every agent needing a decision gets an LLM call (one round per hour)
    for (const a of S.agents) {
      if (!a.alive || !a.needsDecision) continue;
      const plan = await callLLM(a);
      if (plan) {
        SIM.setPlan(S, a, plan.plan, plan.thought || '', plan.goal || '');
        SIM.out(S, 'decision', a.name,
          '🧠 ' + (plan.thought || '').slice(0, 180) + ' → plan: ' +
          a.plan.map(st => SIM.desc(st)).join(' → ')); // a.plan = engine-filtered
      } else {
        // fallback: engine's local brain keeps the world moving; logged as such
        SIM.setPlan(S, a, SIM.localBrain(S, a), 'LLM unavailable — reverted to local reflexes', a.goal);
        SIM.out(S, 'local', a.name, '⚡ LLM failed 3× → local brain plan');
        STATS.fallbacks++;
      }
    }
    // ACT: one virtual hour
    SIM.tick(S);
    // FEEDBACK is implicit: failures land in log+memory, victims get needsDecision
    frames.push({
      h: S.h,
      nodes: { food: S.nodes.food.stock, water: S.nodes.water.stock, wood: S.nodes.wood.stock },
      nodesT: { food: [S.nodes.food.tiles, S.nodes.food.level], water: [S.nodes.water.tiles, S.nodes.water.level], wood: [S.nodes.wood.tiles, S.nodes.wood.level] },
      agents: S.agents.map(a => ({
        name: a.name, loc: a.loc, inv: Object.assign({}, a.inv),
        hunger: Math.round(a.hunger), energy: Math.round(a.energy), health: Math.round(a.health),
        alive: a.alive, status: a.status, goal: a.goal
      }))
    });
    // live stream: il server locale lo espone, la pagina lo ricarica mentre corri
    fs.writeFileSync(path.join(__dirname, 'experiment-live.json'),
      JSON.stringify({ frames, log: S.log, hours: HOURS, mode: MINIMAL ? 'minimal' : 'full', done: false }));
    const alive = S.agents.filter(a => a.alive).length;
    process.stdout.write(`[Day ${SIM.dayOf(S.h)} ${SIM.clockOf(S.h)}] alive=${alive} calls=${Object.values(STATS.calls).reduce((x, y) => x + y, 0)}\n`);
  }

  const out = { frames, log: S.log, stats: STATS, hours: HOURS, mode: MINIMAL ? 'minimal' : 'full' };
  fs.writeFileSync(path.join(__dirname, 'experiment-live.json'), JSON.stringify(Object.assign({}, out, { done: true })));
  fs.writeFileSync(path.join(__dirname, MINIMAL ? 'experiment-minimal.json' : 'experiment.json'), JSON.stringify(out));
  console.log('\n=== EXPERIMENT DONE ===');
  console.log('hours:', HOURS, '| log entries:', S.log.length);
  console.log('LLM calls:', JSON.stringify(STATS.calls));
  console.log('prompt tokens:', JSON.stringify(STATS.promptTok), '| completion:', JSON.stringify(STATS.completionTok));
  console.log('parse/API failures:', STATS.failures, '| local-brain fallbacks:', STATS.fallbacks);
  console.log('survivors:', S.agents.filter(a => a.alive).map(a => a.name).join(', ') || 'none');
  const ling = (STATS.promptTok['inclusionai/ling-3.0-flash'] || 0) / 1e6 * 0.021 +
    (STATS.completionTok['inclusionai/ling-3.0-flash'] || 0) / 1e6 * 0.063;
  console.log('est. cost ling: $' + ling.toFixed(5), '| nemotron free: $0');
  console.log(MINIMAL ? 'wrote experiment-minimal.json (2-rule prompt)' : 'wrote experiment.json');
}

main().catch(e => { console.error(e); process.exit(1); });
