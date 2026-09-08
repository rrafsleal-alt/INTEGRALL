import {spawn} from 'node:child_process';
import net from 'node:net';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  env: {...process.env, NODE_ENV: 'test', PORT: String(port), PUBLIC_URL: '', DATABASE_URL: ''},
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

async function waitForHealth() {
  const deadline = Date.now() + 12_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return res;
      lastError = new Error(`health HTTP ${res.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error('Servidor não iniciou a tempo.');
}

try {
  const health = await waitForHealth();
  const healthJson = await health.json();
  const catalog = await fetch(`${base}/api/catalog`);
  const admin = await fetch(`${base}/api/admin/session`);
  if (!healthJson?.ok) throw new Error('Health não retornou ok=true.');
  if (!catalog.ok) throw new Error(`Catálogo falhou: HTTP ${catalog.status}`);
  if (!admin.ok) throw new Error(`Sessão admin falhou: HTTP ${admin.status}`);
  const adminJson = await admin.json();
  if (adminJson.authenticated !== false) throw new Error('Smoke esperava sessão administrativa não autenticada.');
  console.log(`SMOKE OK - health/catalog/admin em ${base}`);
} catch (error) {
  console.error(`SMOKE FAIL: ${error.message}`);
  if (output.trim()) console.error(output.trim().slice(-4000));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  if (!child.killed) child.kill('SIGKILL');
}
