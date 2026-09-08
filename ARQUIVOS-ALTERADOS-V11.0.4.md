# Arquivos alterados — revisão de 6 de setembro de 2026

Base interna 11.1.8; nomes V11.0.4 conforme briefing. Diff contra o ZIP original, não contra o dist regenerado.

| Caminho | Motivo/descrição | Risco | Teste relacionado |
|---|---|---|---|
| `.env.example` | Define a seleção exclusiva de modo de senha e migração segura. | Baixo; comentários e opções já existentes. | default-admin |
| `CORRECOES-V11.0.4.md` | Substitui relatório histórico por diagnóstico desta entrada. | Documental. | evidências e diff |
| `LEIA-ME-PRIMEIRO.txt` | Direciona para relatórios atuais, sem certificação indevida. | Documental. | revisão documental |
| `MANIFESTO-V11.0.4.txt` | Manifesto da entrega atual e comandos. | Documental. | verificação do pacote |
| `README.md` | Atualiza instruções, modos de senha e limitações atuais. | Documental. | revisão contra comandos executados |
| `TESTES-V11.0.4.md` | Matrizes com aprovados, falhas, limitações e escopos. | Documental. | logs e JSON efetivos |
| `package.json` | Acrescenta suíte de auditoria e comandos de navegador; sem dependência nova. | Baixo; lock preservado. | build offline |
| `public/admin.html` | Mensagem acessível de falha de logout e nova chave de cache do JS. | Baixo. | 13 cenários da ponte e 18 larguras |
| `public/css/store.css` | Substitui painel fixo e duas colunas por fluxo normal/uma coluna; altura livre. | Médio; UX de abertura passa a usar rolagem da página. | 18 larguras, DOM, foco |
| `public/index.html` | Move única região de produto para main após catálogo; sem aria-modal; versiona assets alterados. | Baixo; sem alteração de catálogo/imagens. | 18 larguras reais e fixture |
| `public/js/admin.js` | Guarda de geração, confirmação de logout, revalidação/notificação de sessão e cancelamento de tarefas. | Médio; cookies e eventos nativos ainda requerem E2E. | 13 cenários, 18 larguras e galeria |
| `public/js/store/catalog.js` | Desacopla produto de overlays; limpa campos/galeria; sincroniza variante; preserva teclas de edição. | Médio; hash/reload nativo requer validação. | 29 cenários e 18 mídias reais |
| `public/js/store/commerce-v111.js` | Captura formulário antes de await; descarta resultados antigos; cliente só sai após confirmação. | Médio; API real de cliente fora do escopo. | avaliação assíncrona, reapertura e logout simulado |
| `scripts/audit-admin-browser.py` | Nova ponte da UI aos controladores reais com cookie jar do driver. | Baixo; somente teste, nunca servidor de produção. | 13 cenários e 63 requisições |
| `scripts/audit-real-layout.py` | Novo teste de 18 larguras com os bytes de mídia reais e ordem geométrica/DOM. | Baixo; não testa rede/CSP real. | produtos-reais/results.json |
| `scripts/audit.mjs` | Atualiza contratos para região dentro de main, coluna única e ausência de modal. | Baixo; mantém outras verificações. | npm run audit |
| `scripts/browser-regression.py` | Adapta regressão de layout e adiciona casos de estado; CSS zoom separado como experimento explícito. | Baixo; fixture sem backend. | 29 cenários padrão; 3 falhas do experimento preservadas |
| `scripts/build-production.mjs` | Inclui relatórios atuais no pacote dist. | Baixo. | build offline e manifesto |
| `scripts/hash-admin-password.mjs` | Trata colagem em lote/backspace; conserva espaços significativos; não ecoa senha. | Baixo; terminal físico não homologado. | AUDIT-HASH-01 por pipe |
| `scripts/production-browser-smoke.py` | Atualiza contrato de coluna única e garante 404 de asset ausente na fixture. | Baixo; não executado por bloqueio de navegação. | checagem sintática Python; browser HTTP NÃO EXECUTADO |
| `scripts/production-http-smoke.mjs` | Atualiza contrato CSS e testa 404 real em recursos ausentes. | Baixo; servidor estático de teste, não Express. | 10 verificações HTTP |
| `scripts/security-scan.mjs` | Exige modos exclusivos de senha em vez da antiga precedência de hash. | Baixo; continua exigindo bloqueios de produção/scrypt/cookies. | npm run security:scan |
| `server.js` | Usa os controladores extraídos nas três rotas de sessão administrativa. | Médio; integração Express completa não homologada. | controladores HTTP reais; suíte Express NÃO EXECUTADA |
| `src/admin-session.js` | Centraliza leitura/login/logout reais; valida origem e headers sem cache. | Médio; contrato JSON/cookies preservado. | AUDIT-HTTP-01 e ponte administrativa |
| `src/auth.js` | Falha fechada para papéis inválidos; token v2 vincula hash/papel; valida emissor/tempo. | Médio; exige novo login para sessões v1. | AUDIT-AUTH-01 a 08 |
| `src/config.js` | Modo padrão não aceita hash legado; modo próprio exige false; produção preserva bloqueios. | Médio; instalação com hash próprio e flag true precisa migrar para false. | default-admin, regressão do conflito |
| `tests/audit-regression.test.js` | Onze regressões de permissão, sessão, scrypt/CLI e transporte HTTP real. | Baixo; dados de teste isolados. | npm run test:audit |
| `tests/default-admin.test.js` | Atualiza modo próprio explícito e acrescenta conflito com hash legado. | Baixo; preserva testes de produção. | quatro testes de configuração |
| `tests/fixtures/admin-http-adapter.mjs` | Adaptador Node HTTP dos controladores reais, repositório temporário e injeção de falhas. | Baixo; proibido uso como deploy. | AUDIT-HTTP-01 e ponte |
| `tests/v11.1.2-ux.test.js` | Substitui somente assertivas que exigiam popup pelo novo fluxo solicitado. | Baixo; demais contratos preservados. | suíte offline |
| `tests/v11.1.3-ux.test.js` | Substitui somente assertivas de modal/duas colunas. | Baixo; demais contratos preservados. | suíte offline |
| `tests/v11.1.4-ux.test.js` | Atualiza expectativas de altura/rolagem modal para fluxo normal. | Baixo; demais contratos preservados. | suíte offline |

## Artefatos gerados e preservação
`PATCH-V11.0.4.diff`: diff legível de fontes/testes/configuração; não contém saídas de build ou imagens. `MANIFEST.sha256`: hashes de todos os arquivos finais, exceto o próprio manifesto. Este relatório lista alterações relevantes individualmente; `alteracoes-inventario.json` identifica todos os arquivos modificados/adicionados/removidos.

`dist/`: pacote regenerado, sem minificação, incluindo as mudanças de fonte e relatórios; BUILD-INFO identifica offline. Não interpretar mudança de hash do dist como alteração de dados originais. `docs/evidencias-v11.0.4/`: relatórios JSON, capturas e registros de comandos desta execução; originais preservados no inventário.

Remoção intencional: `backups/originais-v11.1.7/integrall-hero-loop.mp4`, cópia histórica pesada, não referenciada pelo site ou testes; o vídeo ativo permanece idêntico. Os pequenos backups usados pelos testes foram mantidos. Caches e dependências parciais não são entregues.

Nenhuma dependência foi alterada; package-lock.json permanece idêntico à entrada. Nenhuma imagem/vídeo ativo, catálogo, preço ou estoque foi regravado. Token de sessão v1 passa a exigir novo login; não há migração de esquema comercial.
