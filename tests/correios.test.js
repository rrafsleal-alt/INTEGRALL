import test from 'node:test';
import assert from 'node:assert/strict';
import {CorreiosService} from '../src/correios.js';

const CONFIG = {
  user: 'usuario',
  accessCode: 'codigo',
  postageCard: '0067599079',
  contract: '9912345678',
  originCep: '16770-000'
};

function makeProducts() {
  return new Map([
    ['vinho', {
      id: 'vinho', weightGrams: null, lengthCm: 9, widthCm: 9, heightCm: 31,
      variants: [{id: 'v750', weightGrams: 1300}, {id: 'v375', weightGrams: 750}]
    }],
    ['cafe', {id: 'cafe', weightGrams: 300, lengthCm: 18, widthCm: 8, heightCm: 26, variants: []}]
  ]);
}

test('serviço fica não-configurado sem credenciais e configurado com elas', () => {
  assert.equal(new CorreiosService({}).configured, false);
  assert.equal(new CorreiosService(CONFIG).configured, true);
});

test('empacotamento soma pesos com margem, respeita mínimos e detecta dados ausentes', () => {
  const service = new CorreiosService(CONFIG);
  const products = makeProducts();

  const pack = service.packOrder([
    {productId: 'vinho', variantId: 'v750', qty: 2},
    {productId: 'cafe', qty: 1}
  ], products);
  // (1300*2 + 300) * 1.1 + 100 = 3290 -> arredonda para cima
  assert.equal(pack.weightGrams, Math.ceil(2900 * 1.1 + 100));
  assert.equal(pack.missingData, false);
  assert.ok(pack.lengthCm >= 16 && pack.widthCm >= 11 && pack.heightCm >= 2);

  const missing = service.packOrder([{productId: 'inexistente', qty: 1}], products);
  assert.equal(missing.missingData, true);

  const noWeight = service.packOrder([{productId: 'vinho', qty: 1}], products);
  // produto sem weightGrams próprio e sem variantId: falta dado
  assert.equal(noWeight.missingData, true);

  const heavy = service.packOrder([{productId: 'vinho', variantId: 'v750', qty: 30}], products);
  assert.equal(heavy.overweight, true);
});

test('cotação autentica, consulta preço/prazo e escolhe a opção mais barata', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (url.includes('/token/')) {
      return {ok: true, status: 200, json: async () => ({token: 'tok-1', expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    }
    if (url.includes('/preco/')) {
      const body = JSON.parse(options.body);
      assert.equal(body.parametrosProduto[0].cepOrigem, '16770000');
      assert.equal(body.parametrosProduto[0].tpObjeto, '2');
      return {ok: true, status: 200, json: async () => ([
        {coProduto: '03298', pcFinal: '28,50'},
        {coProduto: '03220', pcFinal: '52,10'}
      ])};
    }
    if (url.includes('/prazo/')) {
      return {ok: true, status: 200, json: async () => ([
        {coProduto: '03298', prazoEntrega: 6},
        {coProduto: '03220', prazoEntrega: 2}
      ])};
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const service = new CorreiosService({...CONFIG, fetchImpl});
  const pack = {weightGrams: 3000, lengthCm: 20, widthCm: 15, heightCm: 30, missingData: false, overweight: false};
  const result = await service.quote('01310-930', pack);

  assert.equal(result.options.length, 2);
  assert.equal(result.cheapest.code, '03298');
  assert.equal(result.cheapest.priceCents, 2850);
  assert.equal(result.cheapest.days, 6);
  const sedex = result.options.find(option => option.code === '03220');
  assert.equal(sedex.priceCents, 5210);

  // Segunda chamada idêntica deve vir do cache (sem novas requisições de preço)
  const before = calls.filter(call => call.url.includes('/preco/')).length;
  await service.quote('01310-930', pack);
  const after = calls.filter(call => call.url.includes('/preco/')).length;
  assert.equal(before, after);
});

test('token expirado é renovado automaticamente em caso de 401', async () => {
  let tokens = 0;
  let priceAttempts = 0;
  const fetchImpl = async url => {
    if (url.includes('/token/')) {
      tokens += 1;
      return {ok: true, status: 200, json: async () => ({token: `tok-${tokens}`, expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    }
    if (url.includes('/preco/')) {
      priceAttempts += 1;
      if (priceAttempts === 1) return {ok: false, status: 401, text: async () => 'expirado', json: async () => ({})};
      return {ok: true, status: 200, json: async () => ([{coProduto: '03298', pcFinal: '20,00'}])};
    }
    if (url.includes('/prazo/')) return {ok: true, status: 200, json: async () => ([])};
    throw new Error('URL inesperada');
  };
  const service = new CorreiosService({...CONFIG, fetchImpl});
  const pack = {weightGrams: 1000, lengthCm: 16, widthCm: 11, heightCm: 10, missingData: false, overweight: false};
  const result = await service.quote('01001000', pack);
  assert.equal(result.cheapest.priceCents, 2000);
  assert.equal(tokens, 2);
});

test('erros da API viram mensagens claras', async () => {
  const service = new CorreiosService(CONFIG);
  const packMissing = {weightGrams: 500, lengthCm: 16, widthCm: 11, heightCm: 5, missingData: true, overweight: false};
  await assert.rejects(() => service.quote('01001000', packMissing), /peso/i);
  const packHeavy = {weightGrams: 31000, lengthCm: 16, widthCm: 11, heightCm: 5, missingData: false, overweight: true};
  await assert.rejects(() => service.quote('01001000', packHeavy), /30kg/i);
  await assert.rejects(() => service.quote('123', {missingData: false, overweight: false}), /CEP/i);
});
