> HISTÓRICO DA PRIMEIRA AUDITORIA. A revisão vigente desta entrega é R2; consulte REVISAO-CLIENTE-R2.md e TESTES-CLIENTE-R2.md. Resultados antigos abaixo não certificam a revisão atual.

# Testes — auditoria da base INTEGRALL 11.1.8
Data: 6 de setembro de 2026. Sufixo V11.0.4 mantido pelo nome solicitado da entrega.

## Ambiente e critérios
Node 22.16.0; npm 10.9.2; Python 3.13.5; Playwright Python 1.57.0; Chromium 144.0.7559.96 (Debian 13); Linux x86_64, kernel 6.18.35, glibc 2.41. Sem Express/pg/Mercado Pago instalados com sucesso. Sem TypeScript.

Status: **APROVADO**, **REPROVADO**, **NÃO EXECUTADO** e **NÃO APLICÁVEL**. Uma aprovação abaixo vale somente para o escopo descrito, não para todas as combinações do briefing. “Recarregar documento” na ponte administrativa não significa navegação HTTP nativa nem cookies reais do navegador.

## Antes e depois
| Verificação | Entrada original | Versão corrigida |
|---|---|---|
| Senha inicial sem hash externo | Aceita | Aceita |
| Modo padrão true com hash legado simulado | Senha inicial recusada; credencial legada aceita | Inicial aceita; legada recusada |
| Papel desconhecido no utilitário de permissão | Concedia escrita | Recusado |
| Token após redução do papel | Mantinha validade criptográfica | Recusado pela vinculação à configuração atual |
| Produto desktop | Popup fixo com duas colunas | Região no fluxo, galeria e informações empilhadas |
| Suíte offline | 212 aprovados | 224 aprovados |
| Build completo | 212 aprovados; 1 arquivo de testes falhou por Express ausente | 224 aprovados; 1 arquivo de testes falhou por Express ausente |
| Build offline | Concluído, perfil offline | Concluído, perfil offline |

A causa de configuração foi reproduzida por módulos reais antes da alteração; `inventario/baseline-auth-conflict.json` não contém credenciais. As capturas de “antes” não são um site externo: usam o produto e o código originais em fixture Chromium com imagens reais.

## Execuções e escopo
| Execução | Resultado | Evidência / escopo |
|---|---|---|
| `npm ci` limpo | REPROVADO | Instalação não concluída; DNS do registro indisponível e erro interno npm registrado |
| `npm audit --json` | REPROVADO | Falha de acesso EAI_AGAIN; nenhuma conclusão sobre vulnerabilidades de dependências |
| `npm run check` | APROVADO | Verificação sintática de JS/MJS, não type-check |
| `npm run lint` | APROVADO | Regras locais: conflito de merge, debugger e NUL; não ESLint completo |
| `npm run security:scan` | APROVADO | Varredura local de padrões; não pentest nem npm audit |
| `npm run audit` | APROVADO | Referências, catálogo, DOM, coluna única e contratos do projeto |
| `npm run media:verify` | APROVADO | 43 IDs, 33 imagens únicas e 237 referências nos catálogos |
| `npm run test:offline` | APROVADO | 224 testes, zero falhas, zero pulados; inclui os controladores reais por adaptador Node HTTP |
| `npm run build` | REPROVADO | Falta de Express na suíte HTTP; não houve build completo aprovado |
| `npm run build:offline` | APROVADO | Pacote regenerado com manifesto e perfil explicitamente offline |
| `npm run test:production:http` | APROVADO | 10 verificações de pacote estático por HTTP local, hashes e 404; API propositalmente responde 503 |
| Loja, fixture controlada | APROVADO | 29 cenários: 18 larguras, estados assíncronos, variações, galeria, foco, modais e orientação; `fixture/` |
| Layout com mídias reais | APROVADO | 18 larguras; bytes de imagens reais, posição DOM/geométrica e ausencia de overflow; `produtos-reais/` |
| Administração com controladores reais | APROVADO | 13 cenários e 63 requisições; ponte HTTP + cookie jar do driver, respostas auxiliares simuladas; `admin-controladores/` |
| Responsividade do editor administrativo | APROVADO | 18 larguras com API simulada, não validação de persistência no servidor; `admin-fixture/` |
| Home, vídeo e conta | APROVADO | 10 casos com assets reais, incluindo movimento reduzido e vídeo; `hero/` |
| Galeria administrativa | APROVADO | Dois arquivos selecionados juntos, três fotos no payload e vínculo da variante; XHR/API simulados, não upload real; `galeria/` |
| Experimento CSS zoom | REPROVADO | 3 transbordamentos em 125/150/200%; não é teste de zoom nativo; `experimento-css-zoom/` |
| Browser HTTP em servidor real | NÃO EXECUTADO | Tentativa bloqueada pela política gerenciada ERR_BLOCKED_BY_ADMINISTRATOR |

As capturas mostram a página efetivamente renderizada, sem manipulação para ocultar falhas. Em algumas imagens de produto aparece a indisponibilidade esperada da API fora de HTTP/HTTPS; não foi removida. Fixtures de variações e nomes longos são dados temporários de teste, não produtos adicionados ao catálogo final.

## Matriz de aceitação — autenticação
| ID | Status | Cobertura e limite |
|---|---|---|
| AUTH-001 | APROVADO | Senha vazia recusada pelo controlador real e pela UI de teste |
| AUTH-002 | APROVADO | Senha incorreta recusada |
| AUTH-003 | APROVADO | Hash legado simulado configurado não sobrepõe modo padrão; senha antiga real do usuário não foi fornecida |
| AUTH-004 | APROVADO | Mudança para minúsculas recusada |
| AUTH-005 | APROVADO | Mudança para maiúsculas recusada |
| AUTH-006 | APROVADO | Credencial inicial exata aceita |
| AUTH-007 | APROVADO | Enter aciona login na UI ligada ao controlador real |
| AUTH-008 | APROVADO | Novo documento restaura sessão pela ponte; reload HTTP nativo NÃO EXECUTADO |
| AUTH-009 | APROVADO | API-probe protegida por AdminAuth exige sessão; todas as rotas Express NÃO EXECUTADAS |
| AUTH-010 | APROVADO | Revogação real, cookie de limpeza, falha 503 e nova tentativa |
| AUTH-011 | NÃO EXECUTADO | Voltar/avançar nativos; resposta atrasada após logout foi testada separadamente |
| AUTH-012 | APROVADO | Token v1/corrompido/expirado recusado; storage operacional real de 11.0.3 não fornecido |
| AUTH-013 | APROVADO | Segundo documento revalida revogação ao foco, sob cookie jar compartilhado; eventos de storage same-origin nativos não homologados |
| AUTH-014 | APROVADO | Leituras consecutivas de sessão e reinicialização de documento; ciclo de reload nativo completo não homologado |

A emissão de cookie HttpOnly/Secure/SameSite, CSRF ausente/incorreto, origem inválida, expiração, assinatura corrompida, rotação de hash e redução de papel foi testada no código real. A execução com TLS e a política de cookies do navegador continuam NÃO EXECUTADAS.

## Matriz de aceitação — produto
| ID | Status | Cobertura e limite |
|---|---|---|
| PROD-001 | APROVADO | Detalhes abaixo da galeria, uma região |
| PROD-002 | APROVADO | 320 px, campos e região sem overflow |
| PROD-003 | APROVADO | 768 px, coluna única |
| PROD-004 | APROVADO | 1440 px, coluna única |
| PROD-005 | APROVADO | 1920 px, coluna única |
| PROD-006 | APROVADO | Troca atualiza nome, foto, quantidade, variante e formulários |
| PROD-007 | APROVADO | Fechar limpa estado, não deixa body bloqueado e restaura foco |
| PROD-008 | APROVADO | Reabrir não reaplica resposta de formulário antigo |
| PROD-009 | NÃO APLICÁVEL | Não há seletor autônomo de cor; variação com foto foi exercitada em fixture |
| PROD-010 | NÃO APLICÁVEL | Não há seletor autônomo de tamanho distinto das variações |
| PROD-011 | APROVADO | Quantidade válida ao abrir/trocar; limites e carrinho nos testes existentes |
| PROD-012 | APROVADO | Descrição longa em fixture de memória |
| PROD-013 | APROVADO | Nome longo em fixture de memória |
| PROD-014 | APROVADO | Imagem ausente/corrompida aciona fallback; rede/CDN real não homologada |
| PROD-015 | APROVADO | Produto sem variações mantém interface estável |
| PROD-016 | APROVADO | Abrir/trocar/fechar não duplica região nem as ações testadas; não equivale a teste prolongado de vazamento |
| PROD-017 | NÃO EXECUTADO | Reload nativo com URL de produto aberto |
| PROD-018 | APROVADO | Foco, Escape, Tab e setas em campos exercitados; leitor de tela NÃO EXECUTADO |
| PROD-019 | NÃO EXECUTADO | Zoom nativo 200% sem ambiente verificável |
| PROD-020 | APROVADO | Ordem DOM: catálogo, região, galeria, informação, ações; sem reordenação CSS artificial |

## Responsividade
As larguras efetivamente verificadas foram **280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 px**. Cada largura possui registro geométrico JSON. Há capturas selecionadas em 280, 320, 375, 430, 768, 1024, 1280, 1440, 1920 e 2560 px, além de telas administrativas.

| ID | Status | Verificação |
|---|---|---|
| RESP-001 | APROVADO | 280 px, sem overflow global na fixture |
| RESP-002 | APROVADO | 320 px |
| RESP-003 | APROVADO | 375 px |
| RESP-004 | APROVADO | 430 px |
| RESP-005 | APROVADO | 768 px |
| RESP-006 | APROVADO | 1024 px |
| RESP-007 | APROVADO | 1366 px |
| RESP-008 | APROVADO | 1440 px |
| RESP-009 | APROVADO | 1920 px |
| RESP-010 | APROVADO | 2560 px, produto limitado e centralizado |
| RESP-011 | APROVADO | Simulações horizontais 812×375 e 1024×400 |
| RESP-012 | NÃO EXECUTADO | Zoom nativo 200%; não convertido em aprovação por CSS zoom |

## Matriz de aceitação — build
| ID | Status | Resultado |
|---|---|---|
| BUILD-001 | REPROVADO | npm ci não concluído |
| BUILD-002 | APROVADO | Lint próprio, limitado |
| BUILD-003 | NÃO APLICÁVEL | Projeto JavaScript sem etapa de TypeScript |
| BUILD-004 | APROVADO | Suíte offline de 224 testes |
| BUILD-005 | APROVADO | Integração de controladores/Auth/Repository real via adaptador HTTP; Express não testado |
| BUILD-006 | NÃO EXECUTADO | E2E completo por navegação HTTP; cenários isolados aprovados não o substituem |
| BUILD-007 | REPROVADO | Build completo; build offline aprovado separadamente |
| BUILD-008 | NÃO EXECUTADO | Backend Express de dist não inicializado; smoke estático aprovado |
| BUILD-009 | NÃO EXECUTADO | Console da implantação real; sem pageerror nos cenários Chromium isolados |
| BUILD-010 | NÃO EXECUTADO | Rede completa em produção; requisições da ponte e smoke verificadas |
| BUILD-011 | APROVADO | Hashes/referências locais e respostas 404 de teste; integrações/CDN fora do escopo |
| BUILD-012 | NÃO EXECUTADO | Todas as rotas no Express real com reload e base URL de implantação |

## Persistência, uploads, segurança e desempenho
Os testes de repositório criam, alteram, recarregam e validam dados em diretórios temporários, incluindo falha atômica, concorrência, pedidos/estoque, avaliações, favoritos e dados corrompidos. Testes existentes de upload validam formato, tamanho, assinatura e tratamento de imagens; envio real pelo Express/PostgreSQL não foi executado. Nenhum pedido real foi criado e nenhum catálogo do usuário foi usado como banco de teste.

Há validações locais de links, referências e HTML dinâmico; não há garantia de ausência universal de XSS, injeção ou falhas de upload. Banco PostgreSQL, SMTP, transportadoras, pagamento real, carga, Web Vitals e medição prolongada de memória: **NÃO EXECUTADO**, por ausência de instalação/credenciais/ambiente real. O risco residual é falha de integração ou desempenho não detectada. Para concluir, usar ambiente de homologação com as dependências do lock, PostgreSQL temporário e credenciais sandbox, executar a suíte HTTP, navegador real e fluxos comerciais ponta a ponta.

## Reprodução
```sh
npm run build:offline
npm run test:production:http
npm run test:browser:audit
npm run test:browser:audit:real
npm run test:browser:audit:admin
python3 scripts/admin-browser-regression.py . resultados-editor
python3 scripts/browser-real.py --root . --out resultados-home
```

O experimento separado é reproduzido com `python3 scripts/browser-regression.py --root . --out resultados-css-zoom --experimental-css-zoom`; suas falhas permanecem no relatório. Não há alteração de snapshots para fazê-los passar.

Para homologação completa, em ambiente com acesso ao registro: `npm ci`, `npm run build`, subir o servidor real e executar `npm run test:browser:production:http` e os cenários de sessão/navegação. O smoke de navegador existente é estático: a homologação administrativa ainda precisa ocorrer contra o backend completo, não contra a ponte de teste.

## Validação do ZIP
O ZIP final deve ser extraído em diretório novo; a integridade da cópia é conferida com `npm run source:verify` antes de novos builds, porque o build atualiza seus metadados. O reteste inclui instalação limpa tentada, build offline, 224 testes e smoke HTTP estático. O registro da execução efetivamente feita a partir do ZIP é entregue também como `RETESTE-ZIP-V11.0.4.txt` externo ao pacote, associado ao seu hash exato. Não se declara instalação completa nem build completo aprovado.
