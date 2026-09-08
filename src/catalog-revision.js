import {createHash} from 'node:crypto';

function revisionOf(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
}

export function catalogRevision(catalog) {
  return revisionOf(catalog || {});
}

export function productRevision(product) {
  return revisionOf(product || null);
}

export function assertProductRevision(expected, currentProduct) {
  const supplied = String(expected || '').trim();
  const actual = productRevision(currentProduct);
  if (!supplied || supplied !== actual) {
    const error = new Error('Este produto mudou desde que foi aberto no Admin. Recarregue o produto antes de salvar para não sobrescrever estoque ou dados mais recentes.');
    error.code = 'PRODUCT_REVISION_CONFLICT';
    error.actualRevision = actual;
    throw error;
  }
  return actual;
}

export function assertCatalogRevision(expected, current) {
  const supplied = String(expected || '').trim();
  const actual = catalogRevision(current);
  if (!supplied || supplied !== actual) {
    const error = new Error('O catálogo mudou desde a última leitura. Recarregue o Admin e tente novamente.');
    error.code = 'CATALOG_REVISION_CONFLICT';
    error.actualRevision = actual;
    throw error;
  }
  return actual;
}
export function sectionRevision(value) {
  return revisionOf(value ?? null);
}

export function assertSectionRevision(expected, currentValue, section = 'dados') {
  const supplied = String(expected || '').trim();
  const actual = sectionRevision(currentValue);
  if (!supplied || supplied !== actual) {
    const error = new Error(`A seção ${section} mudou desde a última leitura. Recarregue os dados antes de salvar.`);
    error.code = 'SECTION_REVISION_CONFLICT';
    error.actualRevision = actual;
    throw error;
  }
  return actual;
}

