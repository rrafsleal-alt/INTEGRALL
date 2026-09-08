# Correção v11.0.2 — acesso administrativo

- Senha padrão de acesso à personalização definida como `[CREDENCIAL INICIAL REDIGIDA]`.
- Login passa a aceitar o campo de e-mail em branco.
- Credencial padrão validada por hash scrypt no backend, com sessão assinada, CSRF, RBAC e rate limiting preservados.
- Senha personalizada por `ADMIN_PASSWORD_HASH` é suportada. Na v11.1.1, ela passou a substituir integralmente a credencial inicial, sem fallback concorrente.
- Inicializador corrigido para detectar também `mercadopago` e `pg`, não apenas `express`.
- Novo `PREPARAR-DEPENDENCIAS.bat` recupera instalações ausentes ou parciais com `npm ci`.
- `ABRIR-ADMIN.bat` passa a iniciar o servidor quando necessário e aguarda o health check antes de abrir o painel.
- Novo teste usa o hash padrão real de `src/config.js`, evitando falso positivo com hash criado apenas dentro da suíte.

# CHANGELOG_AUDIT

## v11.1.1 — 2026-09-02

- Detalhes do produto convertidos de modal fixo para bloco inline único abaixo da grade em todas as resoluções.
- Remoção de largura mínima global e correções de overflow no Admin a partir de 280 px.
- Credencial inicial preservada somente como hash scrypt; senha customizada substitui integralmente a inicial; produção bloqueia configuração inicial compartilhada.
- Códigos de acesso do cliente protegidos por HMAC e consumo atômico de uso único.
- Sessões autenticadas com `no-store`, CSRF e validação de origem.
- Normalização automática de catálogos persistidos e unicidade global de IDs de variação.
- Imports de PostgreSQL e Mercado Pago adiados até o recurso ser usado, com falhas explícitas.
- Imagem hero otimizada para WebP; arquivos mojibake e scripts temporários removidos.
- Build de produção determinístico, manifesto SHA-256, smoke HTTP e regressão Chromium do código-fonte e do `dist`.


## v11.0.0 — 30/08/2026

### Segurança
- Proteção real de `/api/admin/*`.
- Login/logout administrativo, sessão assinada, cookie HttpOnly/SameSite/Secure em HTTPS.
- CSRF em mutações administrativas.
- RBAC para admin/editor/operator.
- Rate limit específico para login e rotas administrativas.
- Request ID e padronização de erros.
- Modo TLS PostgreSQL configurável e validação forte de produção.
- Auditoria de ações administrativas em `integrall_audit_log`.

### Upload e mídia
- Upload multipart de JPG/PNG/WebP.
- Validação de assinatura, integridade, tamanho, dimensões e pixels.
- Remoção de metadados desnecessários em formatos suportados.
- UUID, checksum, dimensão, tamanho, alt text, finalidade e autor.
- Provider de storage com implementações memória/local/PostgreSQL.
- Listagem de mídia e exclusão bloqueada quando o arquivo está em uso.
- Upload de logo, favicon, hero e fundos pelo painel.
- Galeria de produto com capa/reordenação/remoção.

### Dados e regras
- Migrations `001_initial` e `002_media_metadata_audit` com rollback disponível quando seguro.
- Runner com checksum e advisory lock.
- Máquina de estados de pedido.
- Atualização atômica do catálogo para reduzir condição de corrida.
- IDs novos baseados em UUID.

### Frontend/UX
- Tela de login administrativa.
- Feedback de sessão expirada e logout seguro.
- Alvos interativos mínimos e ajustes responsivos no admin.
- 404/500 próprias, manifest e robots.
- Metadados SEO/social na home.

### Qualidade/Operação
- 100 testes Node aprovados na validação final.
- Scripts `check`, `test:smoke`, `security:scan`, `db:migrate`, `build` e `verify`.
- Documentação de segurança, deploy, imagem e auditoria.

## v11.1.0 — 2026-09-02

- URLs amigáveis e SEO server-side por produto, incluindo sitemap e Product JSON-LD.
- Busca com sugestões e interpretação simples de intenção/faixa de preço.
- Filtros avançados por atributos, preço e disponibilidade.
- Promoções automáticas server-side e gerenciamento no Admin.
- Barra de progresso para frete grátis.
- Conta do cliente sem senha, favoritos, endereços, histórico e recompra.
- Avaliações restritas a compra verificada, com moderação administrativa.
- Reserva transacional de estoque durante o pagamento e devolução na expiração/cancelamento.
- Alertas de estoque baixo/esgotado e fluxo “Avise-me quando voltar”.
- Migration 003 para contas, sessões, avaliações e inscrições de reposição.


## v11.1.1 — 2026-09-02

### Produto e responsividade
- Modal legado substituído por um único bloco de detalhes no fluxo normal abaixo do catálogo.
- Layout de detalhes fixado em uma coluna em todas as larguras, com foco restaurado, Escape e limpeza de estado.
- Corrigido overflow global em 280 px na loja e no painel.
- Corrigida resposta assíncrona de avaliações que podia reaparecer após fechar/trocar o produto.

### Dados e imagens
- IDs de variação duplicados corrigidos e validação global adicionada.
- Slugs únicos persistidos para os 227 produtos.
- Normalização compatível aplicada ao catálogo local e ao PostgreSQL.
- Fundo principal otimizado para WebP sem remover o PNG social.

### Segurança e operação
- `ADMIN_PASSWORD_HASH` passou a substituir integralmente a credencial inicial; produção recusa a credencial/segredo embutidos.
- Códigos de login do cliente protegidos por HMAC-SHA-256 com segredo próprio, cookie `SameSite=Strict`, `no-store`, same-origin e CSRF.
- Imports de PostgreSQL/Mercado Pago tornados tardios, permitindo validar módulos puros sem mascarar dependência ausente.
- Build determinístico, manifesto SHA-256 e regressões de navegador/HTTP adicionados.
- Scripts temporários de patch removidos; documentação e ferramentas de catálogo tornadas portáveis.

## 2026-09-02 — v11.1.4

- Coordenação de camadas da loja: conta, produto, sacola e acompanhamento não ficam empilhados de forma conflitante.
- Favorito solicitado por visitante é preservado e aplicado após autenticação.
- Busca inteligente recebeu navegação completa por teclado e fechamento por clique externo/Escape.
- `tools/audit_products.py` passou a funcionar no próprio pacote sem PDFs-fonte, marcando corretamente a prova PDF como não executada.
- Smoke de produção atualizado para a arquitetura atual em popup.
- Testes históricos deixaram de fixar cache-busting em uma versão antiga.
- Documentação, comandos e cache-busting sincronizados com v11.1.4.

## 2026-09-02 — v11.1.5

- Modais de Privacidade/Termos/Trocas e acompanhamento passaram a usar backdrop próprio e coordenador de camadas, evitando lock/foco incoerentes.
- Sanitização multilinha preserva parágrafos dos textos legais sem liberar caracteres de controle invisíveis.
- Fallback público embutido volta a manter as quebras de linha originais dos textos legais.
- Smoke HTTP deixou de fixar versão literal; marcador de build deriva do `package.json`.
- Regressão Chromium ganhou cenário de camada legal e texto multilinha; diagnóstico duplicado de conta foi removido.
- Scripts/evidências, cache-busting e metadados sincronizados com v11.1.5.

