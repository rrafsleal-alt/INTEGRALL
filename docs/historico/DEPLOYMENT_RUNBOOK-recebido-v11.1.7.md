# DEPLOYMENT_RUNBOOK — INTEGRALL v11.1.1

## 1. Pré-deploy

1. Faça backup do PostgreSQL e confirme a migration `003_customer_commerce`.
2. Garanta que `.env`, tokens, senhas e chaves privadas não estejam no repositório.
3. Configure `NODE_ENV=production`, `PUBLIC_URL=https://...`, `DATABASE_URL` e, preferencialmente, `DATABASE_SSL_MODE=verify-full`.
4. Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_DEFAULT_LOGIN_ENABLED=false`, `ADMIN_SESSION_SECRET`, `CUSTOMER_AUTH_SECRET` e `ADMIN_ROLE`.
5. Cadastre credenciais externas somente no secret manager da plataforma.
6. Revise preços, disponibilidade, estoque e códigos comerciais antes de publicar o catálogo.

## 2. Instalação e gates

```bash
npm ci
npm run verify:v11.1.1
npm test
npm run test:production
```

`npm test` deve terminar sem SKIP no CI que possui as dependências instaladas. `npm run test:production` gera o `dist/`, valida o staging por HTTP e executa a regressão de navegador sobre os arquivos do build.

## 3. Banco

```bash
npm run db:migrate
```

Migrations usam advisory lock e checksum. Se uma migration aplicada tiver checksum diferente, interrompa o deploy e investigue; não edite migrations já aplicadas.

## 4. Subida

```bash
npm start
```

Valide em staging:

- `GET /api/health` e versão `11.1.1`;
- home, busca, filtros e `/produto/<slug>` após reload direto;
- detalhes sempre abaixo da grade em mobile/tablet/desktop;
- `/admin` protegido, login inválido/válido, reload autenticado e logout;
- criação/edição de produto, múltiplas fotos e foto por variação;
- upload, persistência e reabertura;
- pedido, reserva de estoque, cupom, frete e recompra;
- login da conta por e-mail, avaliações e “Avise-me”;
- Mercado Pago em sandbox e webhook assinado;
- Correios/Jadlog em homologação;
- SMTP para pedidos, login e reposição;
- console, rede, 404 de assets e logs sem dados sensíveis.

## 5. Rollback

1. Retorne ao artefato de aplicação anterior.
2. Reverta migration apenas após backup e análise do `.down.sql`.
3. Nunca faça rollback destrutivo automático de dados comerciais.
4. Preserve catálogo e mídia antes de qualquer restauração.

## 6. Observabilidade

Monitore status HTTP, latência, erros 5xx, falhas de provider, rejeições de webhook, expiração de reserva, falhas de e-mail/upload e estoque negativo. Preserve `X-Request-Id` para correlação e mantenha dados sensíveis redigidos.
