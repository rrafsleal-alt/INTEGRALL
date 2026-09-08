# AUDIT_REPORT — auditoria forense e hardening INTEGRALL

Data: 30/08/2026 — America/Sao_Paulo

## Sumário

O projeto original já possuía catálogo, carrinho, pedidos, PostgreSQL, Mercado Pago, Correios/Jadlog e painel administrativo, porém o painel/API administrativa estavam efetivamente públicos. A intervenção preservou a arquitetura Node.js/Express existente e concentrou-se em segurança, integridade, uploads, migrations, operação e qualidade sem trocar o stack.

## Falhas P0/P1

| Severidade | Falha | Impacto | Correção | Status |
|---|---|---|---|---|
| P0 | `/api/admin/*` sem autenticação | qualquer visitante podia alterar catálogo, preços, estoque, pedidos e consultar clientes | sessão administrativa assinada, login, logout, cookie seguro, CSRF, RBAC e rate limit | corrigido |
| P1 | upload administrativo por JSON/Data URL | DoS por payload, MIME spoofing, baixa rastreabilidade e operação ruim | upload multipart, magic bytes, limites, integridade, metadados, UUID, checksum e exclusão protegida | corrigido |
| P1 | status de pedido sem máquina de estados | regressões e estados comerciais impossíveis | `src/order-state.js` com transições permitidas e validação server-side | corrigido |
| P1 | schema criado/adaptado no boot sem histórico | risco de drift e deploy irreprodutível | migrations SQL versionadas + runner com advisory lock/checksum | corrigido |
| P1 | TLS PostgreSQL com verificação desabilitada fixa | MITM em produção | `DATABASE_SSL_MODE` configurável; produção exige modo seguro e recomenda `verify-full` | corrigido |
| P1 | painel sem login/logout/CSRF/papéis | acesso administrativo indevido | autenticação e papéis `admin`, `editor`, `operator` | corrigido |

## P2/P3 corrigidos

- Request ID em respostas e logs.
- Formato de erro consistente com código e identificador de rastreio.
- Trilha de auditoria de ações administrativas relevantes.
- IDs de produto/mídia com UUID.
- Endpoint de health reduzido e sem instruções de acesso administrativo.
- 404/500 próprias, `robots.txt` e manifest.
- SEO básico reforçado: description, canonical, Open Graph, Twitter Cards e JSON-LD verdadeiro/estático.
- Painel passou a editar imagens gerais do site por upload, incluindo drag-and-drop, progresso e cancelamento.
- Galeria de produto com reordenação, definição de capa, remoção e upload múltiplo na interface.
- Proteção contra exclusão de mídia ainda em uso.
- Abstrações `ShippingProvider` e `PaymentProvider` para desacoplar capacidades externas.
- Scripts de `check`, `security:scan`, `smoke`, `db:migrate`, `build` e `verify`.

## Riscos/P2 residuais

1. **Derivados responsivos de imagem no backend**: o upload valida/sanitiza e a interface pode recortar/otimizar antes do envio, porém não existe pipeline server-side gerando thumbnail/card/zoom/AVIF. Mitigação: limites fortes e metadados; próximo passo recomendado é adicionar um processador isolado (Sharp/libvips) quando o ambiente de deploy for definido.
2. **Object storage de produção**: existe contrato de storage e providers local/memória/PostgreSQL; não foi adicionado adapter S3/R2 sem uma decisão de infraestrutura. O schema não usa base64; no provider PostgreSQL o binário é `BYTEA`.
3. **E2E/Lighthouse/axe em navegador real**: o Chromium disponível no ambiente travou por restrições do runtime/DBus. Nenhuma pontuação foi inventada. A suíte HTTP/integração foi executada e as regras responsivas/acessíveis foram auditadas estaticamente.
4. **Paginação administrativa completa**: endpoints ainda possuem limites altos e não implementam cursor/offset em todas as telas. Não bloqueia operação atual de catálogo pequeno, mas deve ser evoluído com volume real.

## Arquivos centrais

- `server.js` — autenticação, autorização, CSRF, request ID, upload, auditoria e endpoints administrativos.
- `src/auth.js` — senha com scrypt, sessão assinada, cookies e RBAC.
- `src/image-upload.js` — parser multipart e validação/sanitização de imagens.
- `src/media-storage.js` — abstração de storage e providers.
- `src/migrations.js` + `migrations/*.sql` — migrations versionadas.
- `src/order-state.js` — máquina de estados.
- `src/providers.js` — contratos de frete/pagamento.
- `public/admin.html`, `public/js/admin.js`, `public/css/admin.css` — login e administração por upload real.
