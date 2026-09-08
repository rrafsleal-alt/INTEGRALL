/**
 * TESTE APENAS. Carrega callbacks literais de server.js sem substituí-los por
 * cópias. Invoca o handler com req/res mínimos e repositório real; NÃO executa
 * Express, roteamento, parsers, limites, autenticação ou transporte HTTP.
 * A suíte tests/http.test.js continua obrigatória no build completo.
 */
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import * as catalog from '../../src/catalog.js';
import * as revisions from '../../src/catalog-revision.js';
import {applyQuotedShipping, assertShippingEditable} from '../../src/order-financials.js';
import {assertOrderTransition} from '../../src/order-state.js';
import {validateShippingBoxes} from '../../src/shipping-packages.js';

export async function createRouteInvoker(repo, {sourceUrl = new URL('../../server.js', import.meta.url)} = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const httpErrorCode = source.match(/class HttpError extends Error \{[\s\S]*?\n\}/)?.[0];
  if (!httpErrorCode) throw new Error('Classe HttpError não encontrada na fonte.');
  const HttpError = vm.runInNewContext(`(${httpErrorCode})`);
  const centsCode = source.match(/function centsFromBody\(value\) \{[\s\S]*?\n\}/)?.[0];
  if (!centsCode) throw new Error('Validador de centavos não encontrado na fonte.');
  const centsFromBody = vm.runInNewContext(`(${centsCode})`);
  const bindings = {
    ...catalog, ...revisions, repo, HttpError, centsFromBody,
    applyQuotedShipping, assertShippingEditable, assertOrderTransition,
    validateShippingBoxes, newId: prefix => `${prefix}-${randomUUID()}`,
    auditAdmin: async () => {}, processRestockAlerts: async () => {},
    EMAIL_STATUS_EVENTS: new Set(), sendOrderEmail: () => {}, console
  };
  return async (method, route, {body = {}, params = {}} = {}) => {
    const marker = `app.${method.toLowerCase()}('${route}'`;
    const at = source.indexOf(marker);
    if (at < 0 || source.indexOf(marker, at + marker.length) >= 0) throw new Error(`Rota ausente ou ambígua: ${route}`);
    const start = source.indexOf('asyncRoute(', at) + 'asyncRoute('.length;
    const end = source.indexOf('\n}));', start);
    if (start < at || end < start) throw new Error(`Formato inesperado de handler: ${route}`);
    const handler = vm.runInNewContext(`(${source.slice(start, end + 2)})`, bindings);
    let sent = false;
    const response = {
      statusCode: 200, data: null,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(value) { this.data = JSON.parse(JSON.stringify(value)); sent = true; return this; }
    };
    await handler({body, params, headers: {}, method: method.toUpperCase()}, response);
    if (!sent) throw new Error(`Handler não concluiu resposta: ${route}`);
    return {status: response.statusCode, data: response.data};
  };
}
