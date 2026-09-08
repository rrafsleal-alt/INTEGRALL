# Arquivos alterados — Correios PAC/SEDEX

30 arquivos preexistentes alterados e 11 novos, além do build, manifesto, deste relatório, patch e evidências geradas. Nenhum arquivo original de código/dados foi removido.

Base interna 11.1.8. `package-lock.json` idêntico. Arquivos operacionais de dados/assets/backups: 445 idênticos; 446 incluindo o lockfile. O build `dist` foi recriado em perfil offline. O manifesto da fonte foi renovado após empacotamento dos arquivos.

| Arquivo | Tipo | Alteração / risco | Verificação |
|---|---|---|---|
| `.env.example` | Alterado | Variáveis de Correios/segredo em branco, origem confirmável, auth contrato e frete automático. | Diagnóstico sem credenciais; inspeção |
| `APRESENTACAO-AO-CLIENTE.md` | Alterado | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `CONFIGURAR-CORREIOS.md` | Novo | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `DEPLOYMENT_RUNBOOK.md` | Alterado | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `INTEGRACAO-CORREIOS.md` | Novo | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `LEIA-ME-PRIMEIRO.txt` | Alterado | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `MANIFESTO-CORREIOS.txt` | Novo | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `MANIFESTO-V11.0.4.txt` | Alterado | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `README.md` | Alterado | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `TESTES-CORREIOS.md` | Novo | Documentação/entrada da revisão, mantendo histórico e separando ativação/testes/limitações. | Conferência documental |
| `package.json` | Alterado | Novos comandos de teste/diagnóstico/execução local; nenhuma dependência alterada. | Instalação limitada pelo ambiente; scripts offline executados |
| `public/admin.html` | Alterado | Campos de embalagens reais no formulário administrativo existente. | Quatro larguras administrativas |
| `public/css/admin.css` | Alterado | Layout responsivo do editor de caixas sem modificar identidade visual. | 280/320/768/1440 px |
| `public/css/checkout.css` | Alterado | Layout das opções, mensagens e ações de frete. | Oito larguras de cotação |
| `public/js/admin.js` | Alterado | Editor de caixas por produto/variação; valida, salva e reabre campos de embalagem. | Quatro larguras administrativas com API simulada |
| `public/js/store/api.js` | Alterado | Timeout configurável por chamada com limite; orçamento maior para fechamento com transportadora. | Testes locais e regressão da loja |
| `public/js/store/checkout.js` | Alterado | Opções na sacola, seleção/total, expiração, respostas antigas, reconsulta, confirmação manual e fallback quando health falha. | 25 cenários de navegador |
| `render-free-test.yaml` | Alterado | Mesmas opções para a cópia de teste; não confunde sandbox de pagamento com homologação Correios. | Inspeção/configuração; deploy não executado |
| `render.yaml` | Alterado | Novas opções não secretas; segredos solicitados no ambiente e assinatura gerada. | Inspeção/configuração; deploy não executado |
| `scripts/admin-browser-regression.py` | Alterado | Modo de teste opcional do editor de caixas; preserva a regressão administrativa padrão. | Quatro larguras com edição |
| `scripts/build-production.mjs` | Alterado | Inclui diagnóstico e guias Correios no build. | Build offline + verificação de manifesto |
| `scripts/check-correios.mjs` | Novo | Diagnóstico somente leitura, sem APIs e sem impressão de credenciais. | Comando correios:check |
| `scripts/correios-browser-regression.py` | Novo | Reproduz fluxos de cotação/checkout com módulos reais por ponte e Correios simulado. | 25 cenários |
| `scripts/security-scan.mjs` | Alterado | Verifica nomes de novas credenciais na superfície pública. | Scanner local, não auditoria CVE |
| `server.js` | Alterado | Liga o coordenador ao frete/pedido; valida caixas no CRUD/importação; bloqueia pagamento pendente antes de reutilizar preferência. | Verificações estáticas e módulos reais por ponte; Express não executado |
| `src/catalog.js` | Alterado | Preserva caixas inválidas para recusa explícita; frete pendente não vira zero; metadados do frete e modo público. | Testes de catálogo e pedido |
| `src/config.js` | Alterado | Opções privadas de contrato/autenticação/segredo; proteção de hosts e ambiente de homologação. | Teste novo de configuração; diagnóstico |
| `src/correios.js` | Alterado | Autenticação por contrato/cartão; renovação; consultas GET preço/prazo; limites, cache, validação de respostas e erros seguros. | 41 novos testes + testes Correios legados |
| `src/jadlog.js` | Alterado | Permite reconsulta sem cache no fechamento, preservando a integração existente. | Testes Jadlog locais; API externa não executada |
| `src/order-idempotency.js` | Alterado | Serviço/manual entram na intenção de pedido; renovação de recibo não duplica pedido. | Testes de idempotência |
| `src/public-order.js` | Alterado | Projeção de modalidade/prazo/volumes sem custo interno, origem ou caixas. | Testes de projeção pública |
| `src/shipping-checkout.js` | Novo | Validação compartilhada, cotação e fechamento com reconsulta da opção selecionada; não troca serviço silenciosamente. | Testes de fechamento e navegador dedicado |
| `src/shipping-packages.js` | Novo | Planejamento com caixas reais, quantidades exatas, validação de CEP/caixas e limites sem estimativa ou truncamento. | Novos testes de embalagens/CEP |
| `src/shipping-quote.js` | Alterado | Recusa produtos excluídos na entrada de cotação. | Testes de cotação |
| `src/shipping-receipt.js` | Novo | Recibo HMAC com prazo de cinco minutos e assinatura verificável. | Testes de assinatura/adulteração/expiração |
| `tests/catalog.test.js` | Alterado | Modo público Correios reconhecido pela UI, sem depender exclusivamente de health. | Suíte sem dependências |
| `tests/correios-integration.test.js` | Novo | 41 casos novos de integração e segurança do frete. | 301 casos totais aprovados |
| `tests/correios.test.js` | Alterado | Atualiza caixas registradas; mantém cobertura de POST legada com prazo válido. | Suíte sem dependências |
| `tests/fixtures/correios-http-adapter.mjs` | Novo | Servidor local de teste com repositório temporário e respostas Correios simuladas, sem credenciais reais. | Navegador e reconsulta do fechamento |
| `tests/http.test.js` | Alterado | Fixture personalizada desliga acesso administrativo padrão explicitamente. | NÃO EXECUTADO: Express ausente |
| `tests/v11.1.6-expert.test.js` | Alterado | Atualiza referência da validação centralizada no coordenador de frete. | Suíte sem dependências |

## Riscos residuais

Instalação/build completo e servidor Express não aprovados por falta de dependências no ambiente. APIs externas, certificados HTTPS, PostgreSQL e pagamentos não homologados. Pesos/medidas faltantes dependem do cadastro real da loja. Sem esses dados, a cotação é recusada e o pagamento de pedidos pendentes permanece bloqueado.

Os novos scripts de fixture são ferramentas de teste: não são um backend substituto para publicação. Os relatórios anteriores não foram apagados nem convertidos em resultados desta revisão.
