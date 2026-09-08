# Auditoria Forense — INTEGRALL v11.1.1

Data: 02/09/2026

## Resumo executivo

A auditoria partiu da versão v11.1.0 entregue anteriormente e preservou uma cópia intacta do ZIP original antes de qualquer alteração. A versão corrigida passa a ser v11.1.1.

Foram corrigidos problemas funcionais, de responsividade, autenticação, segurança, persistência e qualidade do pacote. A loja e o Admin foram exercitados em Chromium real nas 18 larguras solicitadas: 280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 px.

## Principais problemas encontrados e corrigidos

### P1 — Detalhes do produto ainda eram modal fixo
- **Observado:** o baseline abria `#productModal` com `position: fixed`, overlay e bloqueio do `body`.
- **Esperado:** detalhes em fluxo normal, abaixo da grade de produtos, inclusive no desktop.
- **Causa:** DOM e CSS ainda preservavam a arquitetura de modal lateral/centralizado da versão anterior.
- **Correção:** substituição por `#productDetails`, seção inline única, `position: static`, grid de uma coluna e fechamento sem overlay/trava de rolagem.
- **Prova:** teste de navegador em 18 larguras sem falhas; evidências em `docs/evidencias-v11.1.1/pos-correcao/`.

### P1 — Credencial administrativa inicial e configuração de produção
- **Observado:** atalhos Windows exibiam a senha e a configuração padrão podia ser reutilizada indevidamente em produção.
- **Causa:** credencial inicial divulgada em scripts auxiliares e fallback permissivo de desenvolvimento.
- **Correção:** senha inicial permanece apenas como hash scrypt no backend; atalhos não imprimem senha; credencial customizada substitui integralmente a inicial; produção recusa iniciar com a credencial inicial compartilhada e exige hash próprio + segredo persistente.
- **Prova:** testes de autenticação case-sensitive, senha incorreta, substituição por `ADMIN_PASSWORD_HASH`, sessão, logout e proteção de produção.

### P2 — Overflow em telas de 280 px
- **Observado:** `body{min-width:320px}` e controles administrativos com largura mínima intrínseca causavam estouro.
- **Correção:** removida a largura mínima global e aplicados `min-width:0/max-width:100%` nos containers/formulários críticos.
- **Prova:** loja e Admin sem overflow horizontal global em 18 larguras.

### P2 — IDs de variação duplicados / normalização de dados antigos
- **Observado:** catálogo importado e catálogos persistidos de versões anteriores podiam manter IDs de variações conflitantes e campos novos ausentes.
- **Correção:** normalização do catálogo no carregamento local e após leitura inicial do PostgreSQL; IDs de variação globalmente únicos no catálogo entregue.
- **Prova:** teste automatizado e auditoria estática.

### P2 — Cache de respostas autenticadas e CSRF da conta do cliente
- **Observado:** endpoints de conta precisavam de proteção explícita contra cache compartilhado e validação de origem junto ao token CSRF.
- **Correção:** `Cache-Control: no-store`, checagem same-origin/`Sec-Fetch-Site` e CSRF obrigatório nas mutações autenticadas.
- **Prova:** testes `customer-auth-hardening.test.js`.

### P1 — Checkout podia sobreviver à reserva de estoque
- **Observado:** a preferência do Mercado Pago tinha expiração própria em dias, enquanto a reserva de estoque é curta; isso poderia permitir pagamento após a liberação das unidades.
- **Correção:** `date_of_expiration` da preferência agora é o menor valor entre a expiração configurada do Mercado Pago e `inventoryReservationExpiresAt`.
- **Prova:** `tests/payments-checkout.test.js` valida que a preferência nunca expira depois da reserva.

### P1 — Exposição excessiva na consulta pública de pedido
- **Observado:** a rota de acompanhamento podia reutilizar o objeto interno do pedido e expor campos que não são necessários ao cliente.
- **Correção:** criada uma projeção pública mínima (`src/public-order.js`) que remove dados pessoais, token de checkout, endereço completo, IDs internos e observações/origem do histórico.
- **Prova:** `tests/public-order.test.js` valida ausência desses campos e tolerância a pedidos parciais.

### P2 — Dependências externas carregadas cedo demais
- **Observado:** módulos `pg` e `mercadopago` impediam testes puros quando as dependências não estavam instaladas, mesmo em caminhos que não usavam banco/pagamento.
- **Correção:** imports dinâmicos somente quando PostgreSQL ou Mercado Pago são realmente usados, com erros explícitos caso a dependência necessária esteja ausente.
- **Prova:** suíte independente de dependências externas executa 132/132 testes.

### P3 — Nomes de arquivos Unicode corrompidos
- **Observado:** dois arquivos de texto extraídos de PDF tinham nomes mojibake.
- **Correção:** renomeados para `Cafe Jurere_compressed.txt` e `Catalogo Biscoitos_compressed.txt`; ferramentas passaram a usar resolução de caminhos robusta.

### P3 — Scripts temporários de patch no pacote
- **Observado:** scripts `tools/patch_*` usados durante desenvolvimento permaneciam no pacote e apareciam no manifesto antigo.
- **Correção:** removidos do produto final; ferramentas úteis consolidadas/documentadas.

## Catálogo

- 227 produtos.
- 52 variações.
- Nenhum produto sem imagem local.
- Nenhum ID de produto, slug ou ID de variação duplicado.
- 222 produtos continuam com preço zero e indisponíveis por decisão de conteúdo comercial; não foram ativados artificialmente.
- Há códigos/SKUs de origem repetidos (`331`, `332`, `333`) em itens de catálogo distintos. Eles foram preservados por serem dados de origem e não há evidência suficiente para inventar novos códigos. Recomenda-se validação comercial antes de ativar esses itens.
- A funcionalidade de imagem por variação está implementada e testada; o catálogo entregue ainda possui 0 variações com foto específica configurada.

## Segurança

`npm run security:scan` aprovou 90 arquivos inspecionados. Permanecem apenas dois avisos documentais: o modo `DATABASE_SSL_MODE=require` cifra a conexão sem validar o certificado; produção deve preferir `verify-full` (que já é o padrão exigido/recomendado no deploy).

Nenhuma senha em texto puro foi mantida em assets públicos ou scripts `.bat`. Nenhum `.env` real é incluído no pacote final. `npm audit --omit=dev --offline --json` retornou 0 vulnerabilidades (0 low/moderate/high/critical) para 82 dependências registradas.

## Build e empacotamento

`npm run build:production` concluiu com sucesso:
- versão 11.1.1;
- 292 arquivos no staging `dist`;
- 16.689.955 bytes;
- `BUILD-MANIFEST.sha256` gerado e revalidado byte a byte.

O build de produção é um staging determinístico do servidor Node/Express e assets públicos, sem `node_modules` e sem segredos.

`npm run test:production:http` também foi aprovado: 8 cenários HTTP sobre `dist/public` e 291 hashes do build revalidados. O mesmo build foi reexecutado no Chromium em 18 larguras com 18/18 aprovações.

## Limitações reais do ambiente

1. **`npm ci` limpo:** NÃO EXECUTADO com sucesso. O npm 10.9.2 ficou bloqueado/falhou no acesso ao registry neste ambiente e registrou `Exit handler never called`/timeout. O lockfile foi preservado. Consequência: 15 testes que dependem de Express/PG/Mercado Pago ficaram marcados como `SKIP`, não como aprovados.
2. **PostgreSQL real, Mercado Pago, Correios, Jadlog e SMTP:** não há credenciais/serviços externos disponíveis no ambiente de auditoria; integrações foram validadas por testes unitários/estáticos e contratos de código, não por chamadas reais.
3. **Firefox/WebKit/Safari:** não disponíveis no ambiente. Chromium foi o mecanismo de navegador efetivamente executado.

## Resultado

Estado final da auditoria: **APROVADO COM LIMITAÇÕES DE AMBIENTE DOCUMENTADAS**.

Não há falhas conhecidas nos testes executados. Os itens não executados permanecem explicitamente classificados como tal e não foram convertidos em aprovação.
