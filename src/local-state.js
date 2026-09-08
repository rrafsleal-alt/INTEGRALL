import {randomUUID} from 'node:crypto';
import {mkdir, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';

/** Write, fsync and atomic rename in the same directory. Never truncate live data. */
export async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.warn('Falha na limpeza de arquivo temporário:', error.message); });
  }
}
