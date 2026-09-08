# Arquivos alterados — revisão cliente R2

Comparação com a extração intacta do ZIP auditado anterior. As evidências novas ficam em `docs/revisao-cliente/`. A pasta `dist` é regenerada; seu manifesto específico documenta todos os arquivos. O manifesto da raiz registra os bytes finais de toda a entrega.

| Caminho | Motivo | Alteração | Risco/validação |
|---|---|---|---|
| `APRESENTACAO-AO-CLIENTE.md` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `CORRECOES-V11.0.4.md` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `LEIA-ME-PRIMEIRO.txt` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `MANIFESTO-V11.0.4.txt` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `REVISAO-CLIENTE-R2.md` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `TESTES-CLIENTE-R2.md` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `TESTES-V11.0.4.md` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `package.json` | QA | Acrescenta testes novos às suítes offline e atalhos de execução. | Baixo; sem dependências novas, lock intacto. |
| `public/css/commerce-v111.css` | CLI-09 | Refluxo de nomes/e-mails, campos e botões dentro do painel. | Baixo; 18 larguras, sem redesign. |
| `public/index.html` | CLI-13/14 | Nome acessível do diálogo, foco do backdrop e URLs de assets R2. | Baixo; nome/foco e navegador testados. |
| `public/js/store/api.js` | CLI-03/04 | Erros estruturados, JSON, cancelamento e FormData. | Médio; testes do módulo real em VM. |
| `public/js/store/catalog.js` | CLI-12 | Cancela timers de produto obsoletos e respeita scroll:false. | Médio; antes/depois e regressão de 29 casos. |
| `public/js/store/commerce-v111.js` | CLI-05/06/07/08/13 | Isola gerações de sessão/tela, ordena gravações e corrige conta, endereços, recompra e foco. | Médio; 16 fluxos adicionais + regressão de loja. |
| `scripts/browser-regression.py` | QA | Permite seleção explícita de larguras no reteste; padrão mantém as 18. | Baixo; bateria completa executada. |
| `scripts/build-production.mjs` | QA | Inclui os três documentos principais R2 na distribuição. | Baixo; build offline e hashes conferidos. |
| `scripts/client-browser-regression.py` | QA | Reproduz falhas da conta/rotas com fixture identificada e resultados por cenário. | Somente ensaio; não integra a aplicação. |
| `scripts/client-media-audit.mjs` | QA | Audita mídias em leitura e permite cópias sanitizadas temporárias fora do projeto. | Somente ensaio; dados operacionais não alterados. |
| `server.js` | CLI-07/14 | Importa validador real do perfil; aplica não-cache à rota de conta. | Médio; Express não homologado. |
| `src/customer-auth.js` | CLI-01/02 | Código estrito, e-mail e sessão/expiração válidos. | Médio; testes diretos. |
| `src/customer-profile.js` | CLI-07 | Validação explícita, preservação dos campos não editados e erros estruturados. | Médio; testes com lock real do Repository. |
| `src/image-upload.js` | CLI-11 | Valida conteúdo/dimensões/canvas/quadros WebP preservando variantes válidas. | Médio; 309 arquivos e 223 conteúdos decodificados. |
| `src/media-storage.js` | CLI-10 | Ordena antes do limite; tolera sidecar nulo e amplia limpeza temporária. | Médio; armazenamento local testado, falha de disco não injetada. |
| `src/repository.js` | CLI-02 | Valida expiração/tentativas e elimina sessões inválidas. | Médio; PG real não testado. |
| `tests/client-readiness.test.js` | QA | 36 testes positivos/negativos dos módulos reais. | Somente ensaio, incluído nos 260. |
| `tests/fixtures/client-images/alpha.webp` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `tests/fixtures/client-images/animated.webp` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `tests/fixtures/client-images/lossless.webp` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `tests/fixtures/client-images/lossy.webp` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |
| `tests/fixtures/client-images/metadata.webp` | DOCUMENTAÇÃO | Relatório R2, guia, sinalização histórica ou fixture positiva de teste. | Sem mudança de dados comerciais. |

O patch não repete binários nem resultados gerados. As cinco imagens em `tests/fixtures/client-images/` são dados sintéticos apenas de teste. Nenhum arquivo de `public/assets`, `data` ou `backups` foi alterado nesta revisão. `package-lock.json` permanece idêntico.

Documentos de auditorias anteriores foram mantidos como histórico. Testes antigos permanecem disponíveis; não houve remoção de funcionalidades para forçar aprovação.
