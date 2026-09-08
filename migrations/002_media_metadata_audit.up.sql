ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS original_name TEXT NOT NULL DEFAULT '';
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS alt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS uploaded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'product';
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE integrall_media ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE integrall_media
   SET storage_key = COALESCE(storage_key, id),
       size_bytes = COALESCE(size_bytes, octet_length(data)),
       processing_status = COALESCE(NULLIF(processing_status, ''), 'ready')
 WHERE storage_key IS NULL OR size_bytes IS NULL OR processing_status IS NULL OR processing_status = '';

ALTER TABLE integrall_media ALTER COLUMN storage_key SET NOT NULL;
ALTER TABLE integrall_media ALTER COLUMN size_bytes SET NOT NULL;

CREATE INDEX IF NOT EXISTS integrall_media_created_idx ON integrall_media (created_at DESC);
CREATE INDEX IF NOT EXISTS integrall_media_checksum_idx ON integrall_media (checksum_sha256);

CREATE TABLE IF NOT EXISTS integrall_audit_log (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integrall_audit_log_created_idx ON integrall_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS integrall_audit_log_entity_idx ON integrall_audit_log (entity_type, entity_id, created_at DESC);
