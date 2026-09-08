# TESTES — INTEGRALL v11.1.6

Data: 03/09/2026

## Resultados executados

| Gate | Resultado |
|---|---|
| Testes expert `tests/v11.1.6-expert.test.js` | APROVADO — 48/48 |
| `npm run test:dependency-free` | APROVADO — 196/196 |
| Suíte completa `node --test --test-concurrency=1 tests/*.test.js` | 211 cenários; 196 APROVADOS; 15 SKIP; 0 falhas |
| `npm run check` | APROVADO — 68 arquivos JS |
| `npm run security:scan` | APROVADO — 99 arquivos |
| `npm run audit` | APROVADO |
| `python3 tools/audit_products.py` | APROVADO nas invariantes do pacote |
| `npm audit --offline` | 0 vulnerabilidades registradas |
| Loja Chromium | APROVADO — 18/18 larguras (280–2560) |
| Admin Chromium | APROVADO — 18/18; overflow=0; console errors=0 |
| Galeria/Admin | APROVADO — 2 arquivos -> 2 uploads -> 3 fotos persistidas -> foto da variação |
| Build produção | APROVADO — 297 arquivos |
| Smoke HTTP do `dist` | APROVADO — 8/8; 296 hashes verificados |
| Chromium do `dist` | APROVADO — 18/18 larguras |

## Cenários expert adicionados

Cobrem, entre outros: pagamento após expiração de reserva; recomprometimento de estoque; retry idempotente; advisory lock PostgreSQL; colisão de capability; concorrência do modo memória; revisão otimista de catálogo/produto/seções; tombstones; estoque de variação arquivada; combo com variações de preços; fuzz de descontos; fuzz de reservar/liberar inventário; frete sem dimensões; peso/geometria impossível; promoções malformadas; SEO de produto; alertas/reviews de tombstones; telefone inválido; merge atômico da conta; locks de reposição; checkout MP e reserva.

## 15 testes NÃO EXECUTADOS/SKIP

Todos são do conjunto HTTP real e foram marcados automaticamente com: `NÃO EXECUTADO neste ambiente: dependências npm não instaladas (ERR_MODULE_NOT_FOUND)`.

1. GET `/api/health` responde com recursos e versão.
2. Admin exige sessão e CSRF nas operações de escrita.
3. GET `/api/catalog` não vaza cupons/segredos.
4. Fluxo completo pedido -> status -> admin pago -> estoque -> rastreio.
5. Cupons: admin cria, público valida, pedido aplica.
6. Cotação manual recalcula cupom free_shipping.
7. Quantidade mínima e catálogo protegidos via HTTP.
8. Rotas de pagamento/frete degradam com clareza.
9. Máquina de estados bloqueia regressão administrativa via HTTP.
10. `payment_review` bloqueia novo checkout.
11. `robots.txt` fora de produção.
12. Frete não muda com pagamento em andamento.
13. Admin envia foto e mídia fica disponível via servidor.
14. Admin cria/exclui produto via servidor.
15. Admin salva personalização e loja pública reflete via servidor.

## Instalação limpa

- Online: NÃO EXECUTADA com sucesso; `npm ci` ficou preso/sem resposta do registry neste ambiente.
- Offline: NÃO EXECUTADA; `npm ci --offline` falhou com `ENOTCACHED` porque `xtend-4.0.2.tgz` não existe no cache local.
- Portanto, instalação limpa NÃO é classificada como aprovada.

## Navegadores

- Chromium: APROVADO.
- Chrome nativo: NÃO EXECUTADO.
- Edge nativo: NÃO EXECUTADO.
- Firefox: NÃO EXECUTADO.
- WebKit/Safari: NÃO EXECUTADO.

## Integrações reais

PostgreSQL externo, Mercado Pago, Correios, Jadlog e SMTP com credenciais reais: NÃO EXECUTADOS neste ambiente. Os testes locais não substituem homologação com contas reais/sandbox.

## Evidências

Pasta `docs/evidencias-v11.1.6/` contém capturas e JSONs da loja, Admin, galeria e build de produção.
