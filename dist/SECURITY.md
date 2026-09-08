# Segurança — INTEGRALL v11.1.1

## Administração

O painel `/admin` usa autenticação real no backend. A senha padrão solicitada para primeiro acesso é validada por hash scrypt no servidor e nunca é embutida em texto puro no JavaScript do navegador.

Configure em ambiente seguro:

- `ADMIN_EMAIL`;
- `ADMIN_PASSWORD_HASH` (gere com `npm run admin:hash -- "senha-forte"`);
- `ADMIN_DEFAULT_LOGIN_ENABLED=false` em produção; uma configuração `ADMIN_PASSWORD_HASH` substitui integralmente a credencial inicial, sem fallback concorrente;
- `ADMIN_SESSION_SECRET` com pelo menos 32 caracteres aleatórios e persistentes (sem ele, o processo gera um segredo temporário e encerra as sessões a cada reinício);
- `ADMIN_ROLE=admin|editor|operator`.

A sessão é assinada, possui expiração, cookie `HttpOnly`, `SameSite` e `Secure` em HTTPS. Alterações administrativas exigem token CSRF e as permissões são revalidadas no backend. O login possui rate limiting e mensagens genéricas para reduzir enumeração de usuários.

## Conta do cliente

Os códigos de acesso têm seis dígitos, validade curta, limite de tentativas e são persistidos somente como HMAC-SHA-256 associado ao e-mail e a um segredo exclusivo do servidor. O consumo é atômico, inclusive no PostgreSQL com bloqueio de linha, para impedir reutilização concorrente. Sessões usam token aleatório armazenado apenas como hash no repositório, cookie `HttpOnly`, `SameSite=Strict`, `Secure` em HTTPS, `Cache-Control: no-store` e CSRF com validação de origem nas mutações. Em produção, configure `CUSTOMER_AUTH_SECRET` exclusivo e persistente.

## Upload de imagens

Uploads administrativos usam `multipart/form-data` e são validados no servidor. O backend:

- aceita JPG, PNG e WebP por allowlist;
- verifica assinatura/magic bytes, não apenas extensão;
- limita o arquivo a 10 MB;
- limita dimensões a 8.000 px por lado e 40 milhões de pixels;
- valida integridade estrutural dos formatos suportados;
- remove metadados EXIF/XMP/COM desnecessários quando possível;
- gera identificadores aleatórios com UUID;
- registra checksum SHA-256, tamanho, dimensões, alt text, finalidade e autor;
- impede exclusão de mídia ainda referenciada pelo catálogo;
- nunca usa o nome fornecido pelo usuário como caminho de armazenamento.

SVG é rejeitado por padrão. O endpoint legado de Data URL permanece somente como compatibilidade de migração e passa pela mesma validação binária; a interface principal utiliza upload real de arquivo.

## Pedidos, preços e estoque

O navegador envia IDs, quantidades, variante, presente e dados do cliente/entrega. O servidor consulta o catálogo persistido e recalcula preço unitário, subtotal, frete, descontos e total. Valores monetários enviados pelo navegador não são confiáveis.

`clientOrderId` possui unicidade para idempotência. Cada pedido recebe `checkoutToken` aleatório de alta entropia, comparado em tempo constante. A máquina de estados de pedido bloqueia regressões e transições inválidas.

## Mercado Pago

Quando `MERCADO_PAGO_ACCESS_TOKEN` estiver ativo em produção, `MERCADO_PAGO_WEBHOOK_SECRET` é obrigatório. O webhook é validado, o pagamento é consultado no provedor e valor/moeda/preferência são conferidos no backend antes da alteração de estado. Reenvios não provocam baixa de estoque duplicada.

Nunca armazene número completo de cartão ou CVV. O projeto utiliza o fluxo tokenizado/hospedado do provedor.

## Banco de dados

Migrations versionadas ficam em `migrations/` e são aplicadas com advisory lock e checksum. Faça backup antes de qualquer migration em banco real.

Em produção, prefira `DATABASE_SSL_MODE=verify-full`. O modo `require` existe apenas para provedores que não forneçam cadeia de CA verificável e deve ser tratado como exceção documentada.

## Headers, logs e erros

O servidor desabilita `X-Powered-By`, aplica headers de segurança/CSP, usa request ID, evita stack traces públicos e redige padrões sensíveis dos logs. Não registre senhas, tokens, CVV ou dados pessoais sem necessidade operacional.

## Segredos

Nunca versione `.env`, `DATABASE_URL`, credenciais do Mercado Pago, SMTP, Correios/Jadlog ou segredos administrativos. Use `.env.example` somente como modelo sem valores reais e um secret manager no ambiente de produção.
