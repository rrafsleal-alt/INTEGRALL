import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{10,180}$/;

function assertStorageKey(value) {
  const key = String(value || '');
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error('Chave de armazenamento inválida.');
  return key;
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  throw new Error('MIME de mídia não suportado.');
}

function cloneMetadata(metadata) {
  return JSON.parse(JSON.stringify(metadata));
}

async function removeTemporaryFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(JSON.stringify({level: 'warn', event: 'media_temp_cleanup_failed', file: path.basename(filePath), message: String(error?.message || error).slice(0, 300)}));
  }
}

export class MediaStorageProvider {
  async init() {}
  async save(_media) { throw new Error('save() não implementado.'); }
  async get(_id) { throw new Error('get() não implementado.'); }
  async list(_options) { throw new Error('list() não implementado.'); }
  async delete(_id) { throw new Error('delete() não implementado.'); }
}

export class MemoryMediaStorage extends MediaStorageProvider {
  constructor() {
    super();
    this.items = new Map();
  }

  async save(media) {
    const item = {...cloneMetadata(media), data: Buffer.from(media.data)};
    this.items.set(item.id, item);
    return cloneMetadata({...item, data: undefined});
  }

  async get(id) {
    const item = this.items.get(String(id || ''));
    return item ? {...cloneMetadata(item), data: Buffer.from(item.data)} : null;
  }

  async list({limit = 100} = {}) {
    return [...this.items.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
      .map(item => cloneMetadata({...item, data: undefined}));
  }

  async delete(id) {
    return this.items.delete(String(id || ''));
  }
}

export class LocalMediaStorage extends MediaStorageProvider {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
  }

  async init() {
    await mkdir(this.rootDir, {recursive: true});
  }

  metadataPath(key) {
    return path.join(this.rootDir, `${assertStorageKey(key)}.json`);
  }

  dataPath(key, mimeType) {
    return path.join(this.rootDir, `${assertStorageKey(key)}.${extensionForMime(mimeType)}`);
  }

  async save(media) {
    const key = assertStorageKey(media.storageKey || media.id);
    const metadata = cloneMetadata({...media, storageKey: key, data: undefined});
    const dataPath = this.dataPath(key, media.mimeType);
    const metadataPath = this.metadataPath(key);
    const tempSuffix = `.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(`${dataPath}${tempSuffix}`, Buffer.from(media.data), {flag: 'wx'});
      await writeFile(`${metadataPath}${tempSuffix}`, `${JSON.stringify(metadata, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
      await rename(`${dataPath}${tempSuffix}`, dataPath);
      await rename(`${metadataPath}${tempSuffix}`, metadataPath);
    } catch (error) {
      await removeTemporaryFile(`${dataPath}${tempSuffix}`);
      await removeTemporaryFile(`${metadataPath}${tempSuffix}`);
      throw error;
    }
    return metadata;
  }

  async get(id) {
    const key = assertStorageKey(id);
    try {
      const metadata = JSON.parse(await readFile(this.metadataPath(key), 'utf8'));
      const data = await readFile(this.dataPath(key, metadata.mimeType));
      return {...metadata, data};
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    // Compatibilidade temporária com uploads antigos sem sidecar.
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
      try {
        const data = await readFile(this.dataPath(key, mimeType));
        return {
          id: key,
          storageKey: key,
          mimeType,
          size: data.length,
          width: null,
          height: null,
          altText: '',
          checksum: '',
          originalName: '',
          uploadedBy: '',
          purpose: 'product',
          processingStatus: 'legacy',
          createdAt: '',
          updatedAt: '',
          data
        };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async list({limit = 100} = {}) {
    const names = (await readdir(this.rootDir)).filter(name => name.endsWith('.json')).sort().reverse();
    const output = [];
    for (const name of names) {
      try {
        const metadata = JSON.parse(await readFile(path.join(this.rootDir, name), 'utf8'));
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !STORAGE_KEY_PATTERN.test(String(metadata.id || ''))) {
          throw new Error('Metadados de mídia inválidos.');
        }
        output.push(metadata);
      } catch (error) {
        console.warn(JSON.stringify({level: 'warn', event: 'media_metadata_invalid', file: name, message: String(error?.message || error).slice(0, 300)}));
      }
    }
    // IDs are random. Apply chronological ordering before pagination, as in
    // the memory and PostgreSQL providers, so recent uploads remain visible.
    return output
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || '')))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  async delete(id) {
    const item = await this.get(id);
    if (!item) return false;
    const key = assertStorageKey(item.storageKey || item.id);
    await unlink(this.dataPath(key, item.mimeType)).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    await unlink(this.metadataPath(key)).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    return true;
  }
}

export class PostgresMediaStorage extends MediaStorageProvider {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async save(media) {
    const storageKey = assertStorageKey(media.storageKey || media.id);
    const createdAt = media.createdAt || new Date().toISOString();
    const updatedAt = media.updatedAt || createdAt;
    await this.pool.query(
      `INSERT INTO integrall_media (
         id, storage_key, mime_type, data, original_name, size_bytes, width, height,
         alt_text, checksum_sha256, uploaded_by, purpose, processing_status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         storage_key=EXCLUDED.storage_key, mime_type=EXCLUDED.mime_type, data=EXCLUDED.data,
         original_name=EXCLUDED.original_name, size_bytes=EXCLUDED.size_bytes,
         width=EXCLUDED.width, height=EXCLUDED.height, alt_text=EXCLUDED.alt_text,
         checksum_sha256=EXCLUDED.checksum_sha256, uploaded_by=EXCLUDED.uploaded_by,
         purpose=EXCLUDED.purpose, processing_status=EXCLUDED.processing_status,
         updated_at=EXCLUDED.updated_at`,
      [
        media.id, storageKey, media.mimeType, Buffer.from(media.data), media.originalName || '',
        media.size, media.width, media.height, media.altText || '', media.checksum || '',
        media.uploadedBy || '', media.purpose || 'product', media.processingStatus || 'ready',
        createdAt, updatedAt
      ]
    );
    return {...cloneMetadata(media), storageKey, data: undefined, createdAt, updatedAt};
  }

  async get(id) {
    const {rows} = await this.pool.query(
      `SELECT id, storage_key, mime_type, data, original_name, size_bytes, width, height,
              alt_text, checksum_sha256, uploaded_by, purpose, processing_status, created_at, updated_at
         FROM integrall_media WHERE id = $1`,
      [String(id || '')]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      data: row.data,
      originalName: row.original_name,
      size: row.size_bytes,
      width: row.width,
      height: row.height,
      altText: row.alt_text,
      checksum: row.checksum_sha256,
      uploadedBy: row.uploaded_by,
      purpose: row.purpose,
      processingStatus: row.processing_status,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    };
  }

  async list({limit = 100} = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const {rows} = await this.pool.query(
      `SELECT id, storage_key, mime_type, original_name, size_bytes, width, height,
              alt_text, checksum_sha256, uploaded_by, purpose, processing_status, created_at, updated_at
         FROM integrall_media ORDER BY created_at DESC LIMIT $1`,
      [safeLimit]
    );
    return rows.map(row => ({
      id: row.id,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      originalName: row.original_name,
      size: row.size_bytes,
      width: row.width,
      height: row.height,
      altText: row.alt_text,
      checksum: row.checksum_sha256,
      uploadedBy: row.uploaded_by,
      purpose: row.purpose,
      processingStatus: row.processing_status,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    }));
  }

  async delete(id) {
    const result = await this.pool.query('DELETE FROM integrall_media WHERE id = $1', [String(id || '')]);
    return result.rowCount > 0;
  }
}
