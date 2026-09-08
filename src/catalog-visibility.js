/** Visual catalog: unavailable/unpriced products are not automatically hidden.
 * Input must already have passed normalizeCatalog before public serialization.
 */
export function visibleCatalogProducts(catalog) {
  return (catalog.products || []).filter(product => !product.deletedAt && product.hidden !== true).map(product => {
    const copy = structuredClone(product);
    copy.variants = (copy.variants || []).filter(variant => !variant.deletedAt);
    const ids = new Set(copy.variants.map(variant => variant.id));
    copy.boxes = (copy.boxes || []).filter(box => !box.variantId || ids.has(box.variantId));
    return copy;
  });
}

/** Explicit operator action, not a permanent override of later admin decisions.
 * Never resurrect tombstones or invent price, stock, packaging or descriptions.
 */
export function showAllCatalogProducts(input) {
  if (!input || !Array.isArray(input.products)) throw new Error('Catálogo inválido: produtos ausentes.');
  const catalog = structuredClone(input);
  const summary = {total: catalog.products.length, revealed: 0, pausedWithoutPrice: 0, archived: 0, visible: 0};
  for (const product of catalog.products) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) throw new Error('Produto inválido no catálogo.');
    if (product.deletedAt) { summary.archived++; continue; }
    if (product.hidden === true) { product.hidden = false; summary.revealed++; }
    const variants = (product.variants || []).filter(variant => !variant.deletedAt);
    const prices = variants.length ? variants.map(variant => Number(variant.price)) : [Number(product.price)];
    if (product.available !== false && prices.some(price => !Number.isSafeInteger(price) || price <= 0)) {
      product.available = false;
      summary.pausedWithoutPrice++;
    }
    summary.visible++;
  }
  return {catalog, summary};
}
