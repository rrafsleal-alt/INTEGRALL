# SECURITY_REVIEW

Data: 30/08/2026.

## Riscos encontrados e correções

### P0 — administração exposta

**Antes:** middleware administrativo permissivo; rotas sensíveis podiam ser chamadas sem autenticação.

**Depois:** `AdminAuth` com hash scrypt, sessão HMAC assinada, expiração, cookie HttpOnly/SameSite/Secure em HTTPS, CSRF em mutações, RBAC server-side e rate limiting de login/admin.

### P1 — upload inseguro/frágil

**Antes:** Data URL/base64 como fluxo principal, validação insuficiente e sem metadados operacionais.

**Depois:** multipart, allowlist JPG/PNG/WebP, magic bytes, integridade, 10 MB, 8.000 px/lado, 40 MP, remoção de metadados, UUID, checksum, dimensões, alt text, usuário, finalidade, estado de processamento e bloqueio de exclusão quando em uso. SVG é rejeitado.

### P1 — integridade de pedido

Máquina de estados impede transições inválidas. Preço/frete/desconto/estoque permanecem calculados no backend; webhooks são tratados de forma idempotente e conferidos contra valor/moeda/preferência.

### P1 — banco/migrations

Schema passou a ter migrations versionadas. O runner usa transação, advisory lock e checksum. TLS PostgreSQL é configurável; produção deve usar `verify-full` quando o provedor suportar.

## Controles adicionais

- CSP e headers de segurança já existentes foram preservados/reforçados.
- `X-Powered-By` desativado.
- Request ID para correlação.
- Redação de padrões sensíveis em logs.
- Respostas públicas sem stack trace.
- Trilha de auditoria administrativa.
- Segredos somente por variáveis de ambiente; `.env.example` não contém valores reais.

## Dependências

A consulta ao advisory database do npm não foi concluída por indisponibilidade DNS/registry (`EAI_AGAIN`). O pacote final mantém o lockfile e versões pinadas existentes; esse item deve ser reexecutado em CI com acesso ao registry antes do deploy real.

## Pendências de infraestrutura

- Definir object storage (S3/R2/Supabase etc.) se o volume de mídia justificar; a abstração atual permite adicionar provider sem alterar a UI.
- Configurar credenciais reais de Mercado Pago, Correios/Jadlog e SMTP apenas no secret manager.
- Ativar MFA do provedor de identidade/plataforma para operadores, caso o projeto evolua para autenticação externa.
