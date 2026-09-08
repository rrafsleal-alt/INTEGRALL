import {readFileSync} from 'node:fs';

const recovery = JSON.parse(readFileSync(new URL('../data/recovery-map.json', import.meta.url), 'utf8'));
const repairs = JSON.parse(readFileSync(new URL('../data/catalog-repairs.json', import.meta.url), 'utf8'));
const urls = new Map(recovery.entries.map(entry => [entry.legacyUrl, entry.publicUrl]));

/** Targeted/idempotent: never replace unknown uploads, prices or stock with a seed. */
export function applyRecoveredCatalogRepairs(raw) {
  for (const product of raw.products || []) {
    if (!product || typeof product !== 'object') continue;
    if (Array.isArray(product.images)) product.images = [...new Set(product.images.map(url => urls.get(url) || url))];
    for (const variant of product.variants || []) if (variant?.image) variant.image = urls.get(variant.image) || variant.image;
    const corrected = repairs.names[product.name];
    if (corrected) {
      if (typeof product.description === 'string') product.description = product.description.replace(product.name, corrected);
      product.name = corrected;
    }
  }
  if (raw.commerce?.returnsText === repairs.returnsBefore) raw.commerce.returnsText = repairs.returnsAfter;
  if (raw.commerce && !raw.commerce.supportEmail && raw.settings?.email) raw.commerce.supportEmail = raw.settings.email;
  return raw;
}
