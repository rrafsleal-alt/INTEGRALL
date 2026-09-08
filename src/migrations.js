import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const MIGRATION_PATTERN = /^(\d{3,})_[a-z0-9_-]+\.up\.sql$/i;
const LOCK_ID = 9_624_831_017;

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export async function runMigrations(pool, migrationsDir) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS integrall_schema_migrations (
        version TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDir)).filter(name => MIGRATION_PATTERN.test(name)).sort();
    for (const filename of files) {
      const version = filename.match(MIGRATION_PATTERN)[1];
      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      const hash = checksum(sql);
      const {rows} = await client.query('SELECT checksum_sha256 FROM integrall_schema_migrations WHERE version = $1', [version]);
      if (rows[0]) {
        if (rows[0].checksum_sha256 !== hash) {
          throw new Error(`Migration ${version} foi alterada após aplicação; restaure o conteúdo original ou crie uma nova migration.`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO integrall_schema_migrations (version, checksum_sha256) VALUES ($1, $2)',
          [version, hash]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        error.message = `Falha ao aplicar migration ${filename}: ${error.message}`;
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    } catch (error) {
      console.warn(JSON.stringify({level: 'warn', event: 'migration_unlock_failed', message: String(error?.message || error).slice(0, 500)}));
    }
    client.release();
  }
}
