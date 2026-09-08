# Correções INTEGRALL v11.1.8

**Origem:** INTEGRALL-v11.1.7-RECUPERADO-BISCOITOS-HERO-VIDEO.zip.
**Data:** 05/09/2026.
**Entrega:** fonte completa, arquivos preservados, pacote `dist` e evidências.

## Resultado por achado da auditoria

| Achado | Tratamento aplicado | Verificação / ressalva |
|---|---|---|
| A01 — Fotos ausentes na publicação | 33 derivados estáticos, 43 IDs compatíveis em media-seed, mapa de hashes e reparo idempotente | 43 IDs recuperados em repositório novo; referências verificadas. Banco remoto não acessado |
| A02 — Fallback antigo | Catálogo embutido sincronizado e aviso de contingência na falha da API | Mesmas fotos corrigidas; pagamentos do fallback continuam desativados |
| A03 — Home fixa | Nome, preço, foto, disponibilidade e variação lidos do catálogo; categorias usam fotos atuais | Mudança para R$49,90 em memória refletiu; indisponibilidade/exclusão ocultam destaque |
| A04 — Testes alteravam operação | Pasta temporária, porta transitória e ambiente isolado no HTTP | Dados originais não usados como diretório de escrita; dependência HTTP ausente causa erro, não skip |
| A05 — Pedido perdido, estoque retido | Snapshot atômico de catálogo/pedidos e demais dados duráveis; rollback em falha de commit | Reinício, pagamento, cancelamento, expiração, idempotência e falha de disco simulada passaram |
| A06 — Builds divergentes | Orquestrador único; build:production chama build; perfil offline explícito | Dist contém perfil da validação. Integração completa ainda deve rodar após npm ci |
| A07 — Cabeçalho sobreposto | Removido posicionamento absoluto antigo do menu e também da sacola | Áreas separadas e menu clicável em telas pequenas |
| A08 — Conta mobile oculta | Botão de conta visível com área própria | Abrir/fechar conta e retorno de foco passaram em fixture |
| A09 — Faixas pretas no vídeo | Corte uniforme da área útil ao longo dos oito segundos; capa correspondente | Conteúdo visual preservado, sem faixas incorporadas; original no backup |
| A10 — Vídeo pesado | Desktop 5.118.949 bytes; mobile 1.735.476 bytes, sem áudio, 24 fps | Original 33.448.665 bytes; redução aproximada de 84,7% / 94,8% |
| A11 — Movimento obrigatório | Pausa visível, menor movimento inicial/dinâmico e pausa fora de vista | Velocidade 1,35× mantida; preferência reduzida não inicia o download/loop |
| A12 — PNGs pesados/duplicados | 98.094.806 bytes originais → 9.763.438 bytes de derivados únicos; galerias deduplicadas | Redução de 90,0% no conjunto único para exibição; todos os originais preservados |
| A13 — Cadastros incompletos públicos | 222 ocultos, cinco vendáveis públicos, todos os 227 mantidos | Preços, disponibilidade e estoque comparados com backup: preservados |
| A14 — Dados do fornecedor | Formulário no admin, identidade no rodapé e metadados das políticas, check pré-publicação | CPF/CNPJ/endereço dependem do titular; não inventados; credenciais externas não incluídas |
| A15 — Política genérica | Distinção entre arrependimento, qualidade e avarias; removida condição universal de lacre/revenda | Texto precisa de aprovação para a operação concreta, não é parecer jurídico |
| A16 — Manifestos desatualizados | Manifestos finais e verificador independente de hashes + referências de mídia | Validação do dist após geração e da entrega após empacotar |
| A17 — Indicadores enganosos | Retirado falso typecheck; lint local identificado; HTTP sem skip por dependência; testes novos | 212 offline aprovados; os testes HTTP não foram executados nesta preparação |
| A18 — Nomes e documentação antiga | Corrigidos Coco, Torradinha e nome repetido de Polvilho; guias atuais e histórico identificado | Nenhum preço ou nova variação comercial inventados |

## Preservação

Os 43 PNGs permanecem em `data/local-state/media`. O vídeo e os catálogos recebidos têm backup em `backups/originais-v11.1.7`. O ZIP enviado pelo usuário não foi modificado. O mapa de recuperação relaciona cada ID original ao derivado e a seus hashes. Fotografias diferentes continuam distintas; somente duplicatas exatas foram eliminadas das listas de galeria.

A fonte inclui os originais; o `dist` contém os derivados e a compatibilidade dos IDs, sem dados de operação, segredos ou backups. Não remova pastas de mídia do dist para “enxugar” o deploy sem reavaliar as referências.

## Testes e alcance

Foram executados 212 testes offline sem falhas nem pulados. A regressão controlada original da loja cobre 18 larguras. Uma matriz adicional de dez cenários, executada em lotes, usa os dados e bytes das mídias desta versão: 320, 360, 390, 430, 768, 790, 820, 1024 e 1440 pixels, mais 390 com movimento reduzido. Também confere menu/conta, variação do destaque, alterações de preço e supressão de oferta indisponível.

Esses ensaios de navegador injetam conteúdo em memória e removem CSP apenas da cópia de teste. Não são navegação HTTP real nem teste de rede/servidor. O código de produção conserva sua CSP. O build foi gerado em perfil `offline`; as dependências não puderam ser instaladas neste ambiente. Express real, PostgreSQL externo, pagamento, transportadoras e SMTP precisam de homologação. Ausência de falhas nos testes executados não garante ausência de outros defeitos.

## Passo a passo do responsável pela operação

Abra `README.md` para uso local e `DEPLOYMENT_RUNBOOK.md` para atualizar sem perder dados. Preencha os dados públicos no administrador, configure o ambiente privado e execute `npm ci` seguido de `npm run build` no ambiente de homologação. Promova a versão somente após conferir integrações, produtos, políticas e identificação do fornecedor.

## Referências para revisão jurídica/acessibilidade

- Código de Defesa do Consumidor, arts. 26 e 49: https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm
- Decreto nº 7.962/2013, art. 2º: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm
- W3C, WCAG 2.2, critério 2.2.2: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html

Consulta de referência em 05/09/2026. A correção técnica não é certificação de conformidade integral.

## Conferência adicional desta entrega

O administrador passou nos quatro tamanhos avaliados (320, 390, 768 e 1440 pixels), com API simulada: acesso, saída, rolagem e ausência de transbordamento. O novo formulário comercial foi exercitado em 390 e 1440, enviando apenas configuração comercial e revisão, sem produtos. A atualização da identificação no rodapé foi testada em memória.

Antes de iniciar ou editar a fonte entregue, `npm run source:verify` confere seu manifesto. Depois de operar, diferenças nos dados são esperadas; não restaure o catálogo inicial para fazê-las desaparecer.
