# Análise Técnica Rigorosa — INTEGRALL Online v9.2 (Reavaliação)

**Data:** 15 de agosto de 2026 (2ª análise, após atualização dos arquivos no GitHub)
**Escopo:** `rrafsleal-alt/INTEGRALL`, incluindo commits `7fe2268` (upload dos arquivos), `204e7df` (zip) e `3ed26bb` (remoção do zip)
**Método:** verificação criptográfica dos 51 arquivos contra `MANIFEST.sha256`, leitura de 100% do código-fonte, execução real do servidor, testes funcionais de API (12 cenários), `npm run verify`, `npm audit`.

---

## 1. O que mudou desde a 1ª análise

| Item da 1ª análise | Situação agora |
|---|---|
| 30 arquivos ausentes (src/, public/, data/, tests/, scripts/) | ✅ **Resolvido pelo usuário** — arquivos enviados ao GitHub |
| Arquivos enviados **achatados na raiz** (upload web não preserva pastas) | ✅ **Corrigido por mim** — realocados nas pastas corretas usando os hashes do MANIFEST como mapa |
| `src/catalog.js` ainda faltava (colisão de nome com `public/js/store/catalog.js` no upload achatado) | ✅ **Recuperado por mim** do zip presente no histórico Git (commit `204e7df`) — hash confere |
| `.env` com `ADMIN_API_TOKEN` commitado | ⚠️ **Removido do versionamento** (`git rm --cached`), mas **permanece no histórico** — troque o token |
| Projeto não executava | ✅ **Executa** — servidor sobe, todas as rotas funcionam |

**Verificação de integridade: os 51 arquivos do MANIFEST agora conferem (SHA-256, 51/51 OK).**

> ⚠️ Atenção: o zip `INTEGRALL-online-v9.2-pronto-mercado-pago.zip` foi deletado do `main`, mas continua acessível no histórico (commit `204e7df`) e contém o `.env` com o token. Mais um motivo para **trocar o `ADMIN_API_TOKEN`**.

---

## 2. Validação executada (evidências)

### 2.1 `npm run verify` — APROVADO

- Sintaxe de 14 arquivos JS: OK
- **Testes: 20/20 aprovados** (catálogo/pedido, máquina de estados de pagamento, repositório/estoque)
- Auditoria estática: OK — 5 produtos, assets presentes, 13 arquivos públicos sem segredos

### 2.2 `npm audit` — 0 vulnerabilidades (3 deps diretas, 82 no lockfile)

### 2.3 Testes funcionais reais (servidor em execução, modo memória)

| # | Cenário | Resultado |
|---|---|---|
| 1 | `GET /api/health` | ✅ `ok: true`, modo memória detectado corretamente |
| 2 | Criação de pedido (retirada, 2× Vinho Tinto 750ml) | ✅ `201`, total 5398 centavos correto |
| 3 | Idempotência (mesmo `clientOrderId` reenviado) | ✅ `idempotent: true`, mesmo pedido devolvido |
| 4 | Consulta de status com `checkoutToken` correto | ✅ retorna pedido |
| 5 | Consulta com token errado | ✅ `404` (não vaza existência do pedido) |
| 6 | **Ataque de preço**: cliente envia `unitPriceCents: 1` | ✅ **ignorado** — servidor cobra 2699 do catálogo |
| 7 | Admin sem token | ✅ `401` |
| 8 | Admin → status `paid` | ✅ estoque baixa 1000→998 (só a variante correta), `inventoryCommittedAt` gravado |
| 9 | Admin → `preparing` depois de pago | ✅ **estoque NÃO baixa de novo** (idempotência confirmada) |
| 10 | Pedido com entrega → frete "sob cotação" | ✅ `requiresShippingQuote: true`, pagamento bloqueado |
| 11 | Admin define frete (R$ 18,00) | ✅ total recalculado no servidor (10980→12780) |
| 12 | Checkout MP sem credenciais | ✅ `503` com mensagem clara |

Extras verificados: consolidação de clientes por e-mail/telefone (hash SHA-256 como chave), headers de segurança presentes em todas as respostas (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy).

---

## 3. Revisão do código que faltava na 1ª análise

### `src/repository.js` (351 linhas) — **muito bom**
- Modo duplo memória/PostgreSQL com a mesma interface.
- **Transações corretas**: `BEGIN … SELECT FOR UPDATE … COMMIT/ROLLBACK` na atualização de pedido; o catálogo também é travado com `FOR UPDATE` na baixa de estoque — sem condição de corrida entre webhooks concorrentes.
- Tratamento do erro `23505` (unique violation) devolvendo o pedido duplicado — idempotência robusta mesmo sob corrida na criação.
- Índices adequados (`created_at DESC`, `status` via expressão JSONB).
- `LIMIT` com teto de 500 nas listagens (ponto que eu havia levantado — está tratado ✅).
- Consulta de clientes com upsert JSONB preservando `firstOrderAt`.
- *Ressalva menor:* `ssl: {rejectUnauthorized: false}` em produção — padrão comum no Render, mas aceita MITM teórico; se o provedor der CA, prefira validar.

### `src/catalog.js` (21,8 KB) — **defensivo em profundidade**
- Sanitização exaustiva de todo input (controle de chars, limites de tamanho, whitelist de chaves).
- `safeVisualCss`: bloqueia `@import`, `url()`, `expression()`, `position:fixed`, seletores do admin — CSS custom do lojista não consegue atacar o painel.
- `buildOrder`: valida produto/variante/quantidade/estoque/maxPerOrder, `Number.isSafeInteger` em todos os totais, `checkoutToken` de 192 bits, endereço completo obrigatório para entrega, e-mail com regex, UF com `^[A-Z]{2}$`.
- Frete: pickup zero, fixo, zonas por faixa de CEP com fallback configurável, frete grátis por limiar, cotação como default seguro.

### `src/payment-state.js` — **máquina de estados correta**
- Confere preferência, moeda (BRL) e valor exato em centavos antes de aceitar.
- Divergência em pedido já avançado → **não rebaixa**, só sinaliza (`shouldUpdate: false` + warning).
- Trata approved/refunded/partially_refunded/in_mediation/pending/expired/rejected/charged_back — cobertura completa dos estados do MP.

### `src/payments.js` — correto
- `WebhookSignatureValidator` oficial do SDK, `idempotencyKey` por tentativa, expiração 3–30 dias, exige HTTPS, timeout 8s nos clientes.

### `src/security.js` — correto
- `timingSafeEqual` com checagem de comprimento, CSP estrita (`script-src 'self'`), HSTS quando HTTPS, rate limiter com sweep de memória (sem vazamento de Map).

### Frontend (`public/`)
- CSP também via meta tag; JSON-LD para SEO; noscript fallback.
- `innerHTML` usado **apenas** em 2 templates estáticos (sem interpolação de dados do usuário); dados dinâmicos via `textContent`/DOM — sem vetor XSS identificado.
- Token admin só em `sessionStorage`; dados do cliente em `sessionStorage`; sacola em `localStorage` — conforme SECURITY.md.

---

## 4. Pendências (em ordem de prioridade)

1. **[Alta] Trocar o `ADMIN_API_TOKEN`** (`integrallwine159213` está no histórico do Git em 2 lugares: `.env` do commit inicial e dentro do zip do commit `204e7df`). Gere: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Idealmente, reescreva o histórico ou recrie o repositório limpo.
2. **[Média] Estrutura no `main`**: a correção de pastas está na branch `arena/01a00534-integrall` (commit `257f4c2`, já enviado ao GitHub). Faça o merge para `main` — sem isso, o `main` continua com tudo achatado na raiz e não executa.
3. **[Média] CI**: adicionar GitHub Actions rodando `npm ci && npm run verify` em cada push.
4. **[Baixa] Backup/versionamento do catálogo** no `PUT /api/admin/catalog` (substituição total sem rollback).
5. **[Baixa] Observabilidade**: log estruturado de eventos de pagamento para diagnóstico em produção.
6. **[Baixa] `ssl.rejectUnauthorized: false`**: revisar quando o provedor de Postgres oferecer CA.
7. **[Homologação] Mercado Pago**: seguir `CONFIGURAR-MERCADO-PAGO.txt` com credenciais reais em ambiente HTTPS (única parte não testável sem credenciais).

---

## 5. Veredito final (revisado)

| Dimensão | 1ª análise | Agora |
|---|---|---|
| Integridade do repositório | F (30 arquivos ausentes) | **A** (51/51 conferem; estrutura corrigida nesta branch) |
| Executabilidade | F (não rodava) | **A** (roda; 12/12 cenários funcionais aprovados) |
| Testes | Inverificável | **A** (20/20 aprovados, suíte real e pertinente) |
| Segurança de aplicação | A- (parcial) | **A** (código completo confirma o design: transações, locking, sanitização, XSS ausente) |
| Higiene de segredos | F | **C** (removido do versionamento; falta trocar o token e limpar histórico) |
| Dependências | A | A (0 vulnerabilidades) |

**Conclusão:** com os arquivos completos, o projeto confirma — e supera — a impressão da primeira análise. A implementação é consistente do banco ao navegador: locking transacional correto, idempotência em três camadas comprovada em execução, validação financeira rigorosa e frontend sem vetores de XSS. As pendências reais são operacionais (token comprometido no histórico, merge da estrutura para o `main`, CI) e a homologação com credenciais reais do Mercado Pago. **Estado geral: pronto para homologação.**
