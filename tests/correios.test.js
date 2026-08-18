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
      variants: [{id: 'v750', weightGrams: 1300}, {id: 'v375', weightGrams: 750}],
      boxes: [
        {variantId: 'v750', units: 12, lengthCm: 30, widthCm: 30, heightCm: 24, weightGrams: 14000},
        {variantId: 'v750', units: 6, lengthCm: 30, widthCm: 25, heightCm: 17, weightGrams: 7250}
      ]
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
  // Sem caixa fechada (2 < 6): tudo avulso em um volume.
  assert.equal(pack.packages.length, 1);
  assert.equal(pack.packages[0].weightGrams, Math.ceil(2900 * 1.1 + 100));
  assert.equal(pack.missingData, false);
  const volume = pack.packages[0];
  assert.ok(volume.lengthCm >= 16 && volume.widthCm >= 11 && volume.heightCm >= 2);

  const missing = service.packOrder([{productId: 'inexistente', qty: 1}], products);
  assert.equal(missing.missingData, true);

  const noWeight = service.packOrder([{productId: 'vinho', qty: 1}], products);
  // produto sem weightGrams próprio e sem variantId: falta dado
  assert.equal(noWeight.missingData, true);

  // 30 garrafas: 2 caixas de 12 + 1 de 6 = 3 volumes reais, nenhum acima de 30kg.
  const heavy = service.packOrder([{productId: 'vinho', variantId: 'v750', qty: 30}], products);
  assert.equal(heavy.overweight, false);
  assert.equal(heavy.packages.length, 3);
});

test('caixas reais são usadas para quantidades fechadas e o restante vai avulso', () => {
  const service = new CorreiosService(CONFIG);
  const products = makeProducts();

  // 12 vinhos = exatamente a caixa master real
  const twelve = service.packOrder([{productId: 'vinho', variantId: 'v750', qty: 12}], products);
  assert.equal(twelve.packages.length, 1);
  assert.deepEqual(twelve.packages[0], {weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24});

  // 6 vinhos = caixa de 6 real (7,25kg, não estimativa)
  const six = service.packOrder([{productId: 'vinho', variantId: 'v750', qty: 6}], products);
  assert.equal(six.packages.length, 1);
  assert.equal(six.packages[0].weightGrams, 7250);

  // 20 vinhos = caixa 12 + caixa 6 + 2 avulsos (3 volumes)
  const twenty = service.packOrder([{productId: 'vinho', variantId: 'v750', qty: 20}], products);
  assert.equal(twenty.packages.length, 3);
  assert.equal(twenty.packages[0].weightGrams, 14000);
  assert.equal(twenty.packages[1].weightGrams, 7250);
  assert.ok(twenty.packages[2].loose);

  // Variante sem caixa cadastrada (375ml) nunca usa caixa da 750ml
  const other = service.packOrder([{productId: 'vinho', variantId: 'v375', qty: 12}], products);
  assert.equal(other.packages.length, 1);
  assert.ok(other.packages[0].loose);
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
  const pack = {packages: [{weightGrams: 3000, lengthCm: 20, widthCm: 15, heightCm: 30}], missingData: false, overweight: false};
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
  const pack = {packages: [{weightGrams: 1000, lengthCm: 16, widthCm: 11, heightCm: 10}], missingData: false, overweight: false};
  const result = await service.quote('01001000', pack);
  assert.equal(result.cheapest.priceCents, 2000);
  assert.equal(tokens, 2);
});

test('pedido com múltiplos volumes soma o frete de todas as caixas', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('/token/')) {
      return {ok: true, status: 200, json: async () => ({token: 't', expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    }
    if (url.includes('/preco/')) {
      const body = JSON.parse(options.body);
      requests.push(body.parametrosProduto.length);
      return {ok: true, status: 200, json: async () => body.parametrosProduto.map(p => ({
        coProduto: p.coProduto,
        // preço proporcional ao peso para o teste: R$ 10 por kg
        pcFinal: (Number(p.psObjeto) / 1000 * 10).toFixed(2).replace('.', ',')
      }))};
    }
    if (url.includes('/prazo/')) return {ok: true, status: 200, json: async () => ([])};
    throw new Error('URL inesperada');
  };
  const service = new CorreiosService({...CONFIG, fetchImpl});
  const pack = {
    packages: [
      {weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24},
      {weightGrams: 7250, lengthCm: 30, widthCm: 25, heightCm: 17}
    ],
    missingData: false,
    overweight: false
  };
  const result = await service.quote('01001000', pack);
  // 14kg*10 + 7,25kg*10 = R$ 212,50 por serviço
  assert.equal(result.cheapest.priceCents, 21250);
  assert.equal(result.cheapest.volumes, 2);
  // 2 serviços × 2 volumes = 4 parâmetros num único lote
  assert.deepEqual(requests, [4]);
});

test('erros da API viram mensagens claras', async () => {
  const service = new CorreiosService(CONFIG);
  const packMissing = {packages: [{weightGrams: 500, lengthCm: 16, widthCm: 11, heightCm: 5}], missingData: true, overweight: false};
  await assert.rejects(() => service.quote('01001000', packMissing), /peso/i);
  const packHeavy = {packages: [{weightGrams: 30000, lengthCm: 16, widthCm: 11, heightCm: 5, looseWeightRaw: 31000, loose: true}], missingData: false, overweight: true};
  await assert.rejects(() => service.quote('01001000', packHeavy), /30kg/i);
  await assert.rejects(() => service.quote('123', {packages: [], missingData: false, overweight: false}), /CEP/i);
});

test('rastreio Correios normaliza eventos da API Rastro', async () => {
  const fetchImpl = async (url, options) => {
    if (url.includes('/token/')) return {ok: true, status: 200, json: async () => ({token: 't', expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    if (url.includes('/srorastro/')) {
      assert.match(url, /AA123456789BR/);
      assert.equal(options.headers.Authorization, 'Bearer t');
      return {ok: true, status: 200, json: async () => ({objetos: [{
        codObjeto: 'AA123456789BR',
        dtPrevista: '2026-08-20T20:00:00',
        eventos: [
          {codigo: 'BDE', dtHrCriado: '2026-08-18T14:00:00', descricao: 'Objeto entregue ao destinatário', unidade: {endereco: {cidade: 'SAO PAULO', uf: 'SP'}}},
          {codigo: 'PO', dtHrCriado: '2026-08-16T10:00:00', descricao: 'Objeto postado', unidade: {endereco: {cidade: 'CAFELANDIA', uf: 'SP'}}}
        ]
      }]})};
    }
    throw new Error('URL inesperada: ' + url);
  };
  const service = new CorreiosService({...CONFIG, fetchImpl});
  const result = await service.trackShipment('aa123456789br');
  assert.equal(result.carrier, 'Correios');
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].description, 'Objeto entregue ao destinatário');
  assert.equal(result.events[0].location, 'SAO PAULO - SP');
  assert.equal(result.expectedDelivery, '2026-08-20T20:00:00');
  await assert.rejects(() => service.trackShipment('INVALIDO'), /inválido/i);
});

test('parse de preço tolera formato brasileiro e internacional (proteção contra erro de 100x)', async () => {
  const prices = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('/token/')) return {ok: true, status: 200, json: async () => ({token: 't', expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    if (url.includes('/preco/')) {
      return {ok: true, status: 200, json: async () => ([
        {coProduto: '03298', pcFinal: prices[0]},
        {coProduto: '03220', pcFinal: prices[1]}
      ])};
    }
    if (url.includes('/prazo/')) return {ok: true, status: 200, json: async () => ([])};
    throw new Error('URL inesperada');
  };
  const service = new CorreiosService({...CONFIG, fetchImpl});
  const pack = {packages: [{weightGrams: 1000, lengthCm: 16, widthCm: 11, heightCm: 10}], missingData: false, overweight: false};

  // Formato brasileiro: "1.234,56" = R$ 1.234,56 e "28,50" = R$ 28,50
  prices[0] = '28,50'; prices[1] = '1.234,56';
  let result = await service.quote('01001000', pack);
  assert.equal(result.options.find(o => o.code === '03298').priceCents, 2850);
  assert.equal(result.options.find(o => o.code === '03220').priceCents, 123456);

  // Formato internacional: "28.50" deve ser R$ 28,50 — NUNCA R$ 2.850,00
  service.quoteCache.clear();
  prices[0] = '28.50'; prices[1] = '1234.56';
  result = await service.quote('01001000', pack);
  assert.equal(result.options.find(o => o.code === '03298').priceCents, 2850);
  assert.equal(result.options.find(o => o.code === '03220').priceCents, 123456);
});

test('lote de preço é fatiado em blocos de 5 (limite do manual V2.4)', async () => {
  const batchSizes = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('/token/')) return {ok: true, status: 200, json: async () => ({token: 't', expiraEm: new Date(Date.now() + 3600_000).toISOString()})};
    if (url.includes('/preco/')) {
      const body = JSON.parse(options.body);
      batchSizes.push(body.parametrosProduto.length);
      if (body.parametrosProduto.length > 5) return {ok: false, status: 400, text: async () => 'Limite excedido', json: async () => ({})};
      return {ok: true, status: 200, json: async () => body.parametrosProduto.map(p => ({coProduto: p.coProduto, pcFinal: '10,00'}))};
    }
    if (url.includes('/prazo/')) return {ok: true, status: 200, json: async () => ([])};
    throw new Error('URL inesperada');
  };
  const service = new CorreiosService({...CONFIG, fetchImpl});
  // 3 volumes × 2 serviços = 6 parâmetros → lotes [5, 1]
  const pack = {packages: [
    {weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24},
    {weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24},
    {weightGrams: 7250, lengthCm: 30, widthCm: 25, heightCm: 17}
  ], missingData: false, overweight: false};
  const result = await service.quote('01001000', pack);
  assert.ok(batchSizes.every(size => size <= 5), `lotes: ${batchSizes}`);
  assert.equal(result.options.find(o => o.code === '03298').priceCents, 3000); // 3 volumes × R$10
});
