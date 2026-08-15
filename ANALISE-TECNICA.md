# Análise Técnica Rigorosa — INTEGRALL Online v9.2

**Data da análise:** 15 de agosto de 2026
**Escopo:** repositório `rrafsleal-alt/INTEGRALL`, branch `main`, commit `9d27da1` ("Add files via upload")
**Método:** inspeção de 100% dos arquivos presentes, verificação criptográfica contra `MANIFEST.sha256`, tentativa de execução (`node server.js`), auditoria de dependências (`npm audit`), revisão de segurança e de configuração de deploy.

---

## 1. Resumo executivo

| Dimensão | Avaliação |
|---|---|
| Arquitetura e design (pelo que é visível) | **Forte** — acima da média para e-commerce de pequeno porte |
| Segurança de aplicação (design) | **Forte** — preços server-side, webhook assinado, idempotência |
| Higiene de segredos | **Reprovada** — `.env` com token real commitado |
| Integridade do repositório | **Reprovada** — 30 de 51 arquivos ausentes; projeto não executa |
| Dependências | **Excelente** — 3 deps diretas, 82 no lockfile, 0 vulnerabilidades |
| Documentação | **Excelente** — README, SECURITY, BUILD_REPORT, checklists operacionais |
| Testes/CI | **Inverificável** — testes citados não estão no repo; sem CI |

**Conclusão:** o projeto demonstra engenharia sólida, mas o repositório, no estado atual, é **inexecutável e inseguro para publicação**. Duas ações são bloqueantes antes de qualquer outra coisa (seção 2).

---

## 2. Achados críticos (bloqueantes)

### 2.1 Repositório incompleto — o projeto não roda

O `MANIFEST.sha256` (gerado pelo próprio build) declara **51 arquivos**. O repositório contém **21**. Todos os 21 presentes conferem com seus hashes SHA-256 — ou seja, o que subiu está íntegro; o problema é o que **não subiu**.

Arquivos ausentes (30):

```
src/config.js          src/catalog.js         src/repository.js
src/security.js        src/payments.js        src/payment-state.js
data/catalog.json
public/index.html      public/admin.html
public/css/store.css   public/css/checkout.css  public/css/admin.css
public/js/admin.js
public/js/store/{api,app,cart,catalog,checkout,shipping}.js
public/assets/icons/favicon.svg
public/assets/products/01..05 (.webp, 5 imagens)
scripts/audit.mjs
tests/catalog.test.js  tests/payment-state.test.js  tests/repository.test.js
archive/index.original.html
```

Evidência de execução:

```
$ node server.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/home/user/INTEGRALL/src/config.js' imported from /home/user/INTEGRALL/server.js
```

**Causa provável:** o commit único é "Add files via upload" — upload pela interface web do GitHub, que não incluiu as subpastas.

**Correção:** na máquina onde o projeto completo existe, clonar o repo, copiar a árvore completa e fazer `git add -A && git commit && git push`. Validar depois com `sha256sum -c MANIFEST.sha256`.

### 2.2 Segredo commitado no Git

O `.gitignore` lista `.env`, mas o arquivo **já está versionado** e contém:

```
ADMIN_API_TOKEN=integrallwine159213
```

Problemas:

1. Viola diretamente o `SECURITY.md` do próprio projeto ("Nunca coloque ADMIN_API_TOKEN ... em Git").
2. O token tem 19 caracteres e é derivável da marca; a documentação exige ≥32 caracteres aleatórios.
3. Remover o arquivo agora **não remove do histórico** do Git.

**Correção:**

```bash
git rm --cached .env
git commit -m "Remove .env do versionamento"
# Expurgar do histórico (ou recriar o repositório):
#   git filter-repo --invert-paths --path .env
# Trocar o token — considerá-lo comprometido:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Pontos fortes (avaliação do que é visível)

A análise do `server.js` (338 linhas, única peça de código presente) e da documentação revela decisões corretas e consistentes:

**Integridade financeira**
- O navegador envia apenas IDs/quantidades; o servidor recalcula preço, subtotal, frete e total do catálogo persistido (`buildOrder(req.body, catalog, config)`).
- Webhook do Mercado Pago: valida `x-signature`/`x-request-id`, **consulta o pagamento na API** em vez de confiar no payload, e confere valor/moeda/preferência via `evaluatePayment` antes de mudar estado.
- Máquina de estados explícita com 12 status; webhooks fora de ordem não rebaixam pedido pago.
- Idempotência em camadas: `clientOrderId` único (criação), `inventoryCommittedAt` (baixa de estoque), `attempt` por preferência de pagamento.
- Pagamento bloqueado enquanto frete estiver "sob cotação" (`requiresShippingQuote`), com recálculo server-side quando o admin define o frete.
- Checkout exige base HTTPS antes de criar preferência do Mercado Pago.

**Segurança de aplicação**
- `checkoutToken` de 192 bits separado do ID público, comparado em tempo constante (`safeEqual`).
- Rate limiting por rota com limites proporcionais ao risco (orders 20/min, status 60, payments 30, webhook 180, admin 90).
- Limites de body JSON distintos: 64 kb público, 2 mb admin.
- `x-powered-by` desabilitado, headers de segurança centralizados, mensagens de erro genéricas em produção.
- Cache-Control diferenciado (assets 7 dias, css/js 1 h, admin.html `no-store`, catálogo `stale-while-revalidate`).

**Operação**
- `assertProductionConfig()`: produção exige PostgreSQL; memória só em dev.
- Graceful shutdown (SIGTERM/SIGINT) com timeout de 10 s.
- Blueprints Render separados para produção (starter + Postgres pago, sandbox off) e teste (free, sandbox on); `sync: false` para todos os segredos — correto.
- Docker Compose para Postgres local com healthcheck.
- `.bat` amigáveis para operador não técnico.

**Dependências**
- Apenas `express@5.1.0`, `mercadopago@3.4.0`, `pg@8.16.3`. 82 pacotes no lockfile. `npm audit`: **0 vulnerabilidades**. Engines fixados (`node >=20.12 <27`).

---

## 4. Pontos de atenção (média severidade)

| # | Achado | Impacto | Recomendação |
|---|---|---|---|
| 4.1 | Testes citados ("20/20 aprovados" no BUILD_REPORT) não estão no repo | Alegação de qualidade inverificável | Resolver 2.1; incluir `tests/` |
| 4.2 | Rate limiter em memória | Ineficaz com múltiplas instâncias; zera a cada restart | Aceitável no Render single-instance; documentar a limitação |
| 4.3 | Webhook limitado a 180 req/min | Rajadas do MP podem receber 429 (ele reenvia, mas atrasa confirmação) | Monitorar; considerar limite maior ou allowlist |
| 4.4 | `PUT /api/admin/catalog` substitui o catálogo inteiro, sem versionamento | Erro do admin apaga preços/estoques sem rollback | Guardar snapshot anterior (tabela de versões ou backup pré-save) |
| 4.5 | Sem observabilidade (logs estruturados, request log, métricas) | Diagnóstico em produção limitado a `console.error` | Adicionar pino/morgan e logging de eventos de pagamento |
| 4.6 | Sem CI (nenhum GitHub Actions) | `npm run verify` só roda manualmente | Workflow simples: `npm ci && npm run verify` em push/PR |
| 4.7 | Reembolso não repõe estoque (decisão documentada) | Correto operacionalmente, mas exige disciplina manual | Manter; sinalizar no Admin pedidos reembolsados com estoque baixado |

## 5. Pontos menores (baixa severidade)

- **Line endings inconsistentes nos `.bat`**: `INICIAR-INTEGRALL.bat` usa CRLF; os demais, LF puro — alguns cenários do `cmd.exe` se comportam mal com LF. Padronizar CRLF e adicionar `.gitattributes` (`*.bat text eol=crlf`).
- Senha do Postgres hardcoded no `docker-compose.yml` (`integrall_local_2026`) — aceitável por ser estritamente local, mas vale registrar.
- `GET /api/admin/orders` aceita `limit` sem teto explícito visível no server.js (`Number(req.query.limit) || 300`) — verificar se `repo.listOrders` impõe máximo.
- SPA fallback devolve `index.html` com status 404 — funcional, porém pode confundir crawlers; avaliar 200 para rotas conhecidas do cliente.

---

## 6. Plano de correção priorizado

1. **[Bloqueante]** Reenviar o projeto completo via `git push` (não upload web). Validar: `sha256sum -c MANIFEST.sha256` deve passar para os 51 arquivos.
2. **[Bloqueante]** `git rm --cached .env`, expurgar do histórico, gerar novo `ADMIN_API_TOKEN` aleatório de 64 hex chars.
3. **[Alta]** Rodar e comprovar `npm run verify` no repositório publicado; adicionar GitHub Actions com esse comando.
4. **[Média]** Versionamento/backup do catálogo no `PUT /api/admin/catalog`.
5. **[Média]** Logging estruturado mínimo (request + eventos de pagamento).
6. **[Baixa]** `.gitattributes` para `.bat`; revisar teto de `limit` nas rotas admin.
7. **[Homologação]** Seguir o roteiro já existente em `CONFIGURAR-MERCADO-PAGO.txt` (compra de teste, webhook aprovado, falha/expiração, nova tentativa).

---

## 7. Veredito final

O design do sistema é **maduro e defensivo** — recalcula tudo no servidor, não confia no navegador nem no payload do webhook, trata idempotência em três camadas e documenta a operação com qualidade rara em projetos desse porte. Porém, **o repositório publicado não representa o projeto**: falta 60% dos arquivos (incluindo todo o backend real e o frontend), o que o torna inexecutável, e há um segredo administrativo exposto no histórico do Git.

**Nota conceitual do design: A-. Nota do repositório no estado atual: F.**
Resolvidos os itens 1 e 2 do plano, o projeto tem base sólida para homologação com o Mercado Pago.
