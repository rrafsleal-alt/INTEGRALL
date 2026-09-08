import pg from 'pg';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from '../src/config.js';
import {runMigrations} from '../src/migrations.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL ausente. Defina a conexão PostgreSQL antes de executar db:migrate.');
  process.exit(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');
let ssl = false;
if (config.databaseSslMode === 'require') ssl = {rejectUnauthorized: false};
if (config.databaseSslMode === 'verify-full') ssl = {rejectUnauthorized: true, ...(config.databaseCa ? {ca: config.databaseCa} : {})};

const pool = new pg.Pool({connectionString: config.databaseUrl, ssl});
try {
  await runMigrations(pool, migrationsDir);
  console.log('Migrations aplicadas com sucesso.');
} finally {
  await pool.end();
}
