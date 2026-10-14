// Agent Village local server: static files + start/watch LLM simulations.
// Usage: node server.js   → http://localhost:8733  (NEW SIM button only appears here,
// GitHub Pages stays static and hides it)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8733;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.css': 'text/css', '.png': 'image/png' };

let child = null; // runner attivo

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ running: !!child }));
    return;
  }

  if (url === '/api/new' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    if (child) { res.end(JSON.stringify({ running: true })); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch (e) {}
      const hours = Math.min(720, Math.max(6, +o.hours || 72));  // cap 30 giorni, la run lunga è 15 (360h)
      try { fs.unlinkSync(path.join(ROOT, 'experiment-live.json')); } catch (e) {}  // niente dati stale di run precedenti
      const args = [path.join(ROOT, 'run_experiment.js'), String(hours)];
      if (o.minimal) args.push('--minimal');
      child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
      child.on('exit', () => { child = null; });
      console.log('[new sim] hours=' + hours + ' minimal=' + !!o.minimal);
      res.end(JSON.stringify({ started: true, hours }));
    });
    return;
  }

  // static
  let p = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, () => console.log('agent-village → http://localhost:' + PORT));
