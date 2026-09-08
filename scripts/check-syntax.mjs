import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const roots = ['server.js', 'src', 'scripts', 'tests', path.join('public', 'js')];
const files = [];

async function walk(target) {
  const full = path.join(root, target);
  const entries = await readdir(full, {withFileTypes: true});
  for (const entry of entries) {
    const rel = path.join(target, entry.name);
    if (entry.isDirectory()) await walk(rel);
    else if (/\.(?:js|mjs)$/i.test(entry.name)) files.push(rel);
  }
}

for (const target of roots) {
  if (/\.(?:js|mjs)$/i.test(target)) files.push(target);
  else await walk(target);
}

function nodeCheck(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${file}\n${stderr.trim()}`)));
  });
}

const failures = [];
for (const file of files.sort()) {
  try { await nodeCheck(file); }
  catch (error) { failures.push(error.message); }
}

if (failures.length) {
  console.error(`SYNTAX CHECK FAIL (${failures.length}/${files.length})`);
  for (const failure of failures) console.error(`\n${failure}`);
  process.exit(1);
}
console.log(`SYNTAX CHECK OK - ${files.length} arquivos JavaScript verificados`);
