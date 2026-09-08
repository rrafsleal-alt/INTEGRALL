import {randomUUID} from 'node:crypto';
import {cleanText} from './catalog.js';

function invalid(message, code = 'ACCOUNT_PROFILE_INVALID') {
  throw Object.assign(new Error(message), {status: 400, code});
}

/** Validate only explicitly edited fields. Old addresses are not silently migrated. */
export function sanitizeAccountPatch(body = {}, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Informe os dados da conta em um objeto válido.');
  for (const field of ['name', 'phone']) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'string') invalid('Nome e telefone devem ser textos.');
  }
  let addresses = current.addresses || [];
  if (Object.hasOwn(body, 'addresses')) {
    if (!Array.isArray(body.addresses)) invalid('Informe uma lista de endereços válida.', 'ACCOUNT_ADDRESS_INVALID');
    if (body.addresses.length > 5) invalid('Você pode salvar até 5 endereços. Remova um antes de adicionar outro.', 'ACCOUNT_ADDRESS_LIMIT');
    addresses = body.addresses.map(address => {
      if (!address || typeof address !== 'object' || Array.isArray(address)) invalid('Endereço inválido.', 'ACCOUNT_ADDRESS_INVALID');
      const cep = String(address.cep || '').trim();
      if (!/^[0-9]{5}-?[0-9]{3}$/.test(cep)) invalid('Informe um CEP com 8 dígitos.', 'ACCOUNT_ADDRESS_INVALID');
      const rawState = String(address.state || '').trim().toUpperCase();
      const item = {
        id: cleanText(address.id, 80) || randomUUID(), label: cleanText(address.label, 80),
        cep: cep.replace('-', ''), street: cleanText(address.street, 180), number: cleanText(address.number, 40),
        complement: cleanText(address.complement, 120), neighborhood: cleanText(address.neighborhood, 120),
        city: cleanText(address.city, 120), state: rawState
      };
      if (!item.street || !item.number || !item.city || !/^[A-Z]{2}$/.test(rawState)) {
        invalid('Preencha rua, número, cidade e UF do endereço.', 'ACCOUNT_ADDRESS_INVALID');
      }
      return item;
    });
    if (new Set(addresses.map(item => item.id)).size !== addresses.length) invalid('Os endereços devem possuir identificadores distintos.', 'ACCOUNT_ADDRESS_INVALID');
  }
  if (Object.hasOwn(body, 'favorites') && !Array.isArray(body.favorites)) invalid('Informe uma lista de favoritos válida.');
  const favorites = (Object.hasOwn(body, 'favorites') ? body.favorites : current.favorites || []).slice(0, 500).map(id => cleanText(id, 120)).filter(Boolean);
  return {
    ...current,
    name: Object.hasOwn(body, 'name') ? cleanText(body.name, 80) : cleanText(current.name, 80),
    phone: Object.hasOwn(body, 'phone') ? cleanText(body.phone, 30) : cleanText(current.phone, 30),
    addresses, favorites: [...new Set(favorites)]
  };
}
