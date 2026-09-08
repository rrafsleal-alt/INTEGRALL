/** Embalagens REAIS, sem margens inventadas nem truncamento de peso/medidas. */
export const MAX_SHIPPING_PACKAGES = 30;
export function normalizeShippingCep(value) {
  const cep = String(value ?? '').trim();
  return /^\d{5}-?\d{3}$/.test(cep) && cep.replace('-', '') !== '00000000' ? cep.replace('-', '') : '';
}

export function validPackage(pkg) {
  return Boolean(pkg && Number.isSafeInteger(pkg.weightGrams) && pkg.weightGrams > 0 && pkg.weightGrams <= 30_000
    && ['lengthCm', 'widthCm', 'heightCm'].every(key => Number.isSafeInteger(pkg[key]) && pkg[key] > 0 && pkg[key] <= 100)
    && pkg.lengthCm >= 16 && pkg.widthCm >= 11 && pkg.heightCm >= 2
    && pkg.lengthCm + pkg.widthCm + pkg.heightCm <= 200);
}

// Valida a entrada administrativa ANTES da normalização do catálogo (que pode
// limitar valores). Nunca transforma uma caixa maior/pesada em outra menor.
export function validateShippingBoxes(boxes, variants = []) {
  if (!Array.isArray(boxes) || boxes.length > 10) throw new Error('Cadastre no máximo 10 embalagens por produto.');
  const ids = new Set(variants.filter(v => !v.deletedAt).map(v => v.id));
  const keys = new Set();
  for (const [i, box] of boxes.entries()) {
    if (!box || !Number.isSafeInteger(box.units) || box.units < 1 || box.units > 999 || !validPackage(box)) {
      throw new Error(`Embalagem ${i + 1}: informe unidades inteiras, peso bruto de até 30.000 g e medidas externas válidas (mínimo 16 × 11 × 2 cm, até 100 cm por lado e soma até 200 cm).`);
    }
    if (box.variantId && !ids.has(box.variantId)) throw new Error(`Embalagem ${i + 1}: a variação não existe. Salve a variação antes de vinculá-la.`);
    const key = `${box.variantId || ''}|${box.units}`;
    if (keys.has(key)) throw new Error('Não repita uma embalagem com a mesma quantidade e variação.');
    keys.add(key);
  }
}

export function packRegisteredOrder(items, productsById) {
  const packages = [];
  let missingData = false;
  let overweight = false;
  const merged = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = JSON.stringify([item.productId, item.variantId || '']);
    const qty = Number(item.qty);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) { missingData = true; continue; }
    const entry = merged.get(key) || {...item, qty: 0};
    entry.qty += qty;
    if (entry.qty > 999) { missingData = true; continue; }
    merged.set(key, entry);
  }
  if (!merged.size) missingData = true;
  for (const line of merged.values()) {
    const product = productsById.get(line.productId);
    const variantId = line.variantId || '';
    if (!product || (variantId && !(product.variants || []).some(v => v.id === variantId && !v.deletedAt))) {
      missingData = true; continue;
    }
    // Caixas específicas prevalecem sobre genéricas com a mesma quantidade.
    const byUnits = new Map();
    const applicable = (product.boxes || []).filter(b => !b.variantId || b.variantId === variantId);
    for (const box of [...applicable.filter(b => !b.variantId), ...applicable.filter(b => b.variantId)]) {
      if (Number.isSafeInteger(box.units) && box.units > 0 && box.units <= 999) byUnits.set(box.units, box);
    }
    const boxes = [...byUnits.values()].filter(validPackage).sort((a, b) => b.units - a.units);
    // Programação dinâmica: 4 + 4 atende 8 unidades; o guloso 6 + sobra falharia.
    const dp = Array(line.qty + 1).fill(null); dp[0] = [];
    for (let count = 1; count <= line.qty; count += 1) {
      for (const box of boxes) {
        if (box.units > count || !dp[count - box.units]) continue;
        const candidate = [...dp[count - box.units], box];
        if (candidate.length <= MAX_SHIPPING_PACKAGES && (!dp[count] || candidate.length < dp[count].length)) dp[count] = candidate;
      }
    }
    if (!dp[line.qty]) {
      missingData = true;
      if (applicable.some(b => b.weightGrams > 30_000)) overweight = true;
      continue;
    }
    for (const box of dp[line.qty]) {
      packages.push({weightGrams: box.weightGrams, lengthCm: box.lengthCm, widthCm: box.widthCm, heightCm: box.heightCm});
    }
  }
  if (!packages.length || packages.length > MAX_SHIPPING_PACKAGES) missingData = true;
  return {packages, missingData, overweight, packingMode: 'registered'};
}
