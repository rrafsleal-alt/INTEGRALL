import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Execute the exact pure helper shipped in catalog.js, without simulating a DOM.
const source = await readFile(new URL('../public/js/store/catalog.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf('const __integrallData=')), context);
const paging = context.IntegrallCatalogPagination;
const plain = value => JSON.parse(JSON.stringify(value));

test('PAGE-01: tamanho fixo 12; primeira e última páginas do Gourmet', () => {
  assert.equal(paging.PAGE_SIZE, 12);
  assert.deepEqual(plain(paging.windowFor(82, 1)), {page:1,totalPages:7,start:0,end:12,total:82});
  assert.deepEqual(plain(paging.windowFor(82, 7)), {page:7,totalPages:7,start:72,end:82,total:82});
});
test('PAGE-02: todas as 227 entradas são alcançáveis sem repetição nem omissão', () => {
  const input = Array.from({length:227}, (_, i) => `product-${i}`), seen = [];
  for (let n = 1; n <= paging.windowFor(input.length).totalPages; n++) {
    const page = paging.windowFor(input.length, n), chunk = input.slice(page.start,page.end);
    assert.ok(chunk.length <= 12); assert.ok(chunk.length > 0); seen.push(...chunk);
  }
  assert.equal(paging.windowFor(227, 19).end - paging.windowFor(227, 19).start, 11);
  assert.deepEqual(seen,input); assert.equal(new Set(seen).size,227);
});
test('PAGE-03: resultados vazios e múltiplos exatos não criam páginas fantasma', () => {
  for (const total of [0,1,11,12,13,24,25,82,129,227]) {
    const last=paging.windowFor(total,999);
    assert.equal(last.end,total); assert.equal(last.totalPages,Math.ceil(total/12));
    assert.ok(last.end-last.start <= 12); assert.equal(last.page,Math.max(1,Math.ceil(total/12)));
  }
});
test('PAGE-04: página negativa, fracionada, inválida e excessiva são limitadas', () => {
  for (const value of [-2,0,NaN,Infinity,1.5,'bad',{},undefined]) assert.equal(paging.windowFor(82,value).page,1);
  assert.equal(paging.windowFor(82,'3').page,3);
  assert.equal(paging.windowFor(82,100).page,7);
  for (const total of [-1,NaN,Infinity,1.2,{}]) assert.equal(paging.windowFor(total).total,0);
});
test('PAGE-05: catálogo menor após atualização limita a página sem ficar vazio', () => {
  assert.equal(paging.windowFor(227,19).page,19);
  assert.deepEqual(plain(paging.windowFor(13,19)), {page:2,totalPages:2,start:12,end:13,total:13});
});
test('PAGE-06: até sete páginas têm todos os números sem reticências', () => {
  assert.deepEqual(plain(paging.numbers(1,7)),[1,2,3,4,5,6,7]);
  assert.deepEqual(plain(paging.numbers(1,0)),[]);
});
test('PAGE-07: janela compacta preserva primeira, última e atual', () => {
  for (const total of [8,19,100,500]) for (let n=1;n<=total;n++) {
    const all=plain(paging.numbers(n,total)),numbers=all.filter(x=>x!==null);
    assert.ok(numbers.includes(1) && numbers.includes(total) && numbers.includes(n));
    assert.equal(new Set(numbers).size,numbers.length);assert.ok(numbers.length<=7);
    assert.ok(numbers.every(x=>x>=1&&x<=total));
    assert.ok(all.every((x,i)=>x!==null || (i>0&&i<all.length-1&&all[i-1]!==null&&all[i+1]!==null)));
  }
});
test('PAGE-08: controles usam números, aria-current e substituição de cards', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/<nav[^>]+id="catalogPagination"/);assert.doesNotMatch(html,/id="loadMoreProducts"/);
  assert.match(source,/items\.slice\(paging\.start, paging\.end\)/);
  assert.match(source,/grid\.replaceChildren\(\)/);assert.match(source,/setAttribute\('aria-current', 'page'\)/);
  assert.match(source,/criteria !== state\.catalogCriteria/);assert.match(source,/state\.catalogPage = 1/);
  assert.match(source,/restoreCatalogView\(view\)/);
});
test('PAGE-09: fotos Gourmet preenchem o mesmo quadro sem alterar a galeria completa', async () => {
  const css=await readFile(new URL('../public/css/premium-v104.css',import.meta.url),'utf8');
  const base=await readFile(new URL('../public/css/store.css',import.meta.url),'utf8');
  assert.match(source,/product\.department === 'petit-four' \? 'scene' : 'product'/);
  assert.match(css,/\[data-card-image-layout="scene"\] \.card-image-main\{object-fit:cover/);
  assert.match(base,/\.card-image-main\{position:absolute;inset:0;display:block/);
  assert.match(css,/grid-auto-rows:1fr/);assert.doesNotMatch(css,/card-actions\{display:none/);
});
