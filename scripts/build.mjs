import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['--offline']);
for (const arg of process.argv.slice(2)) if (!allowed.has(arg)) throw new Error(`Opção desconhecida: ${arg}`);
const offline = process.argv.includes('--offline');
const profile = offline ? 'offline' : 'full';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function execute(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && command === npm, env: {...process.env, ...extraEnv}});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`BUILD v11.1.8 — perfil ${profile}. ${offline ? 'Integração HTTP NÃO será declarada aprovada.' : 'Dependências HTTP e todos os testes são obrigatórios.'}`);
for (const script of ['catalog:embed', 'check', 'lint', 'security:scan', 'audit', 'media:verify', offline ? 'test:offline' : 'test']) execute(npm, ['run', script]);
execute(process.execPath, ['scripts/build-production.mjs'], {INTEGRALL_BUILD_PROFILE: profile});
execute(process.execPath, ['scripts/verify-release.mjs', 'dist']);
console.log(`BUILD CONCLUÍDO (${profile}). Consulte dist/BUILD-INFO.json; serviços externos não são homologados por este comando.`);
