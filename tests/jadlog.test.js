import test from 'node:test';
import assert from 'node:assert/strict';
import {JadlogService} from '../src/jadlog.js';

const CONFIG = {
  token: 'token-teste',
  cnpj: '12.345.678/0001-90',
  conta: '123456',
  originCep: '16770-000',
  modalidade: 3
};

test('serviço fica não-configurado sem credenciais e configurado com elas', () => {
  assert.equal(new JadlogService({}).configured, false);
  assert.equal(new JadlogService({token: 'x'}).configured, false);
  const ok = new JadlogService(CONFIG);
  assert.equal(ok.configured, true);
  assert.equal(ok.cnpj, '12345678000190');
  assert.match(ok.label, /\.Package/);
});

test('peso cobrado é o maior entre real e cubado (divisor 6000)', () => {
  const service = new JadlogService(CONFIG);
  // 14kg reais, cubado 30*30*24/6000 = 3,6kg -> cobra 14kg
  assert.equal(service.chargeableKg({weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24}), 14);
  // 1kg real, caixa 60x40x30 -> cubado 12kg -> cobra 12kg
  assert.equal(service.chargeableKg({weightGrams: 1000, lengthCm: 60, widthCm: 40, heightCm: 30}), 12);
});

test('cotação envia payload correto e soma múltiplos volumes', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, headers: options.headers, body: JSON.parse(options.body)});
    const body = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        frete: body.frete.map(item => ({...item, vltotal: item.peso * 5, prazo: 4}))
      })
    };
  };
  const service = new JadlogService({...CONFIG, fetchImpl});
  const pack = {
    packages: [
      {weightGrams: 14000, lengthCm: 30, widthCm: 30, heightCm: 24},
      {weightGrams: 7250, lengthCm: 30, widthCm: 25, heightCm: 17}
    ],
    missingData: false,
    overweight: false
  };
  const result = await service.quote('01310-930', pack, 30000);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, 'token-teste');
  const sent = calls[0].body.frete;
  assert.equal(sent.length, 2);
  assert.equal(sent[0].cepori, '16770000');
  assert.equal(sent[0].cepdes, '01310930');
  assert.equal(sent[0].modalidade, 3);
  assert.equal(sent[0].peso, 14);
  // valor declarado rateado por peso: 14000/21250 do total
  assert.ok(sent[0].vldeclarado > sent[1].vldeclarado);

  // 14*5 + 7.25*5 = 106.25
  assert.equal(result.cheapest.priceCents, 10625);
  assert.equal(result.cheapest.days, 4);
  assert.equal(result.cheapest.volumes, 2);
  assert.match(result.cheapest.label, /Jadlog/);

  // cache: segunda chamada idêntica não refaz a requisição
  await service.quote('01310-930', pack, 30000);
  assert.equal(calls.length, 1);
});

test('erros da API Jadlog viram mensagens claras', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({frete: [{}], error: {id: -1, descricao: 'Numero de contrato invalido'}})
  });
  const service = new JadlogService({...CONFIG, fetchImpl});
  const pack = {packages: [{weightGrams: 1000, lengthCm: 20, widthCm: 20, heightCm: 20}], missingData: false, overweight: false};
  await assert.rejects(() => service.quote('01001000', pack), /contrato invalido/i);

  const fetchHttp = async () => ({ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({})});
  const service2 = new JadlogService({...CONFIG, fetchImpl: fetchHttp});
  await assert.rejects(() => service2.quote('01001000', pack), /HTTP 401/);

  await assert.rejects(() => service2.quote('123', pack), /CEP/i);
  const packMissing = {packages: [], missingData: true, overweight: false};
  await assert.rejects(() => service2.quote('01001000', packMissing), /peso/i);
});

test('mais de 3 volumes são fatiados em múltiplas chamadas', async () => {
  const batches = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    batches.push(body.frete.length);
    return {ok: true, status: 200, json: async () => ({frete: body.frete.map(item => ({...item, vltotal: 10, prazo: 5}))})};
  };
  const service = new JadlogService({...CONFIG, fetchImpl});
  const pack = {
    packages: Array.from({length: 5}, () => ({weightGrams: 1000, lengthCm: 20, widthCm: 20, heightCm: 20})),
    missingData: false,
    overweight: false
  };
  const result = await service.quote('01001000', pack);
  assert.deepEqual(batches, [3, 2]);
  assert.equal(result.cheapest.priceCents, 5000);
  assert.equal(result.cheapest.volumes, 5);
});

test('rastreio Jadlog normaliza eventos (mais recente primeiro)', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(url, /tracking\/consultar/);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.consulta, [{shipmentId: '12345678901234'}]);
    return {ok: true, status: 200, json: async () => ({consulta: [{
      codigo: '000000001',
      tracking: {
        codigo: '12345678901234',
        status: 'EM ROTA',
        eventos: [
          {data: '2026-08-16 09:00:00', status: 'EMISSAO', unidade: 'PA BAURU'},
          {data: '2026-08-17 15:00:00', status: 'EM ROTA DE ENTREGA', unidade: 'PA SAO PAULO'}
        ]
      },
      previsaoEntrega: '2026-08-19'
    }]})};
  };
  const service = new JadlogService({...CONFIG, fetchImpl});
  const result = await service.trackShipment('12345678901234');
  assert.equal(result.carrier, 'Jadlog');
  assert.equal(result.events[0].description, 'EM ROTA DE ENTREGA');
  assert.equal(result.events[0].location, 'PA SAO PAULO');
  assert.equal(result.expectedDelivery, '2026-08-19');

  const notFound = new JadlogService({...CONFIG, fetchImpl: async () => ({ok: true, status: 200, json: async () => ({consulta: [{erro: {descricao: 'Não localizado'}}]})})});
  await assert.rejects(() => notFound.trackShipment('99999999999999'), /Não localizado/);
});
