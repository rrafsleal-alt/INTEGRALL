import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {showAllCatalogProducts} from '../src/catalog-visibility.js';
import {normalizeCatalog} from '../src/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--apply', '--server-stopped', '--help'].includes(arg))) {
  throw new Error('Opção desconhecida. Use --help.');
}
if (args.has('--help') || !args.has('--apply') || !args.has('--server-stopped')) {
  console.log('Pare o servidor e faça backup da pasta. Para mostrar todos os produtos do catálogo operacional, execute:\n  npm run catalog:show-all -- --apply --server-stopped\nO comando lê a configuração privada local, faz backup e altera apenas visibilidade/disponibilidade sem preço. Não restaura itens excluídos.');
  if (!args.has('--help')) process.exitCode = 2;
} else {
  try { process.loadEnvFile(path.join(root, '.env')); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const {config} = await import('../src/config.js');
  const {Repository} = await import('../src/repository.js');
  const initialCatalog = normalizeCatalog(JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8')));
  const localDataDir = process.env.LOCAL_DATA_DIR ? path.resolve(process.env.LOCAL_DATA_DIR) : path.join(root, 'data/local-state');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const backupDir = path.join(config.databaseUrl ? path.join(root, 'backups') : localDataDir, 'visibilidade', stamp);
  await mkdir(backupDir, {recursive: true, mode: 0o700});
  // Preserve the exact local files BEFORE Repository.init normalizes a legacy state.
  if (!config.databaseUrl) {
    for (const name of ['state.json', 'catalog.json']) {
      try { await copyFile(path.join(localDataDir, name), path.join(backupDir, name), constants.COPYFILE_EXCL); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
  const repo = new Repository({
    databaseUrl: config.databaseUrl, initialCatalog, production: config.env === 'production', localDataDir,
    databaseSslMode: config.databaseSslMode, databaseCa: config.databaseCa,
    migrationsDir: path.join(root, 'migrations'), inventoryReservationMinutes: config.inventoryReservationMinutes
  });
  try {
    await repo.init();
    let summary;
    await repo.mutateCatalog(async current => {
      const result = showAllCatalogProducts(current);
      normalizeCatalog(result.catalog); // Validate, but do not use normalization to rewrite commercial data.
      await writeFile(path.join(backupDir, 'catalog-before.json'), `${JSON.stringify(current, null, 2)}\n`, {flag: 'wx', mode: 0o600});
      summary = result.summary;
      return result.catalog;
    });
    console.log(JSON.stringify({result: 'OK', ...summary, backup: path.relative(root, backupDir), pricesAndStock: 'preservados', next: 'Reinicie o servidor e atualize a página.'}, null, 2));
  } finally { await repo.close(); }
}
