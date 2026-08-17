import test from 'node:test';
import assert from 'node:assert/strict';

// Reproduz a lógica de seleção de transportadora do server.js para validar a
// regra CARRIER_SPLIT_UNITS de forma isolada (unidades -> transportadora).
function selectCarriers(available, splitUnits, totalUnits) {
  let carriers = available;
  if (splitUnits > 0 && available.length > 1) {
    const preferredName = totalUnits > splitUnits ? 'Jadlog' : 'Correios';
    carriers = available.filter(carrier => carrier.name === preferredName);
    if (!carriers.length) carriers = available;
  }
  return carriers.map(carrier => carrier.name);
}

const BOTH = [{name: 'Correios'}, {name: 'Jadlog'}];

test('até 12 unidades vai pelos Correios; acima, pela Jadlog', () => {
  assert.deepEqual(selectCarriers(BOTH, 12, 1), ['Correios']);
  assert.deepEqual(selectCarriers(BOTH, 12, 6), ['Correios']);
  assert.deepEqual(selectCarriers(BOTH, 12, 12), ['Correios']);   // exatamente 1 caixa
  assert.deepEqual(selectCarriers(BOTH, 12, 13), ['Jadlog']);     // passou de 1 caixa
  assert.deepEqual(selectCarriers(BOTH, 12, 24), ['Jadlog']);
});

test('com apenas uma transportadora configurada, a regra não bloqueia nada', () => {
  assert.deepEqual(selectCarriers([{name: 'Correios'}], 12, 30), ['Correios']);
  assert.deepEqual(selectCarriers([{name: 'Jadlog'}], 12, 2), ['Jadlog']);
});

test('split 0 desativa a regra: todas cotam sempre', () => {
  assert.deepEqual(selectCarriers(BOTH, 0, 30), ['Correios', 'Jadlog']);
  assert.deepEqual(selectCarriers(BOTH, 0, 2), ['Correios', 'Jadlog']);
});

test('limite customizado é respeitado', () => {
  assert.deepEqual(selectCarriers(BOTH, 6, 6), ['Correios']);
  assert.deepEqual(selectCarriers(BOTH, 6, 7), ['Jadlog']);
});
