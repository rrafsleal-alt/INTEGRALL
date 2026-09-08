import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../public/js/store/catalog.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('admin permite vincular uma foto da galeria a cada variação', () => {
  assert.match(admin, /data-variant-field=['"]image['"]/);
  assert.match(admin, /Foto da variação/);
  assert.match(admin, /productImages\.includes\(image\)\?image:''/);
});

test('loja sincroniza a galeria ao trocar a variação e aceita até 12 fotos', () => {
  assert.match(store, /slice\(0, 12\)/);
  assert.match(store, /function syncGalleryToVariant/);
  assert.match(store, /modalVariant.*addEventListener\('change'/s);
  assert.match(store, /variantDisplayImage\(item\.product/);
});

test('backend persiste a foto da variação e protege mídia referenciada', () => {
  assert.match(server, /image: variant\?\.image/);
  assert.match(server, /product_variant/);
});
