# AUDITORIA DE COERÊNCIA — INTEGRALL v11.1.4

## Resumo executivo

A revisão foi realizada sobre a v11.1.3 e encontrou problemas reais de integração entre camadas, acessibilidade da busca, rastreabilidade de ferramentas e validações obsoletas. Todos os problemas P1/P2 encontrados que podiam ser corrigidos sem alterar dados comerciais legítimos foram tratados.

## Achados e status

| ID | Severidade | Achado | Status |
|---|---|---|---|
| UX-114-01 | P1 | Conta podia abrir sobre o produto; foco permanecia preso na camada de trás e o `body` podia ser destravado incorretamente | CORRIGIDO |
| UX-114-02 | P2 | Favorito de visitante era perdido ao exigir login | CORRIGIDO |
| A11Y-114-01 | P2 | Sugestões de busca apareciam visualmente sem navegação equivalente por setas/Escape | CORRIGIDO |
| TOOL-114-01 | P2 | `tools/audit_products.py` não funcionava no ZIP entregue por depender de PDFs ausentes | CORRIGIDO |
| QA-114-01 | P2 | Smoke de produção ainda validava layout histórico incompatível com o popup atual | CORRIGIDO |
| QA-114-02 | P2 | Testes de versões anteriores falhavam ao encontrar cache-busting de uma versão mais nova | CORRIGIDO |
| DOC-114-01 | P3 | `LEIA-ME-PRIMEIRO.txt` e README apontavam para versões/comandos antigos | CORRIGIDO |
| DATA-114-01 | P3 | SKUs 331/332/333 repetidos | INVESTIGADO; mantido porque o próprio material-fonte reutiliza os códigos |
| DATA-114-02 | P3 | Nenhuma das 52 variações usa foto específica no catálogo atual | DADO A PREENCHER; funcionalidade validada |

## Catálogo

- 227 produtos;
- 52 variações;
- 0 IDs de produto duplicados;
- 0 slugs duplicados;
- 0 IDs globais de variação duplicados;
- 0 imagens referenciadas ausentes;
- 0 fotos de variação apontando para fora da galeria;
- 0 caixas apontando para variação inexistente;
- 0 produtos ativos sem preço;
- 0 produtos sem imagem.

O pacote possui atualmente 5 produtos vendáveis no fallback embutido. Os demais produtos indisponíveis/sem preço comercial não foram ativados artificialmente durante a auditoria.

## Segurança

- scanner interno: APROVADO;
- `npm audit --offline --omit=dev`: 0 vulnerabilidades registradas no lock/cache disponível;
- credencial administrativa não é adicionada a assets públicos por esta revisão;
- permanece o aviso já existente: em produção, preferir `DATABASE_SSL_MODE=verify-full` em vez de `require`, pois `require` aceita TLS sem validar a identidade do servidor.

## Limitações reais do ambiente

1. A instalação limpa via npm não pôde ser concluída de forma confiável porque o registry ficou inacessível/intermitente. O diretório parcial de `node_modules` não faz parte da entrega final.
2. Por isso, 15 cenários HTTP que dependem de Express/PostgreSQL/Mercado Pago foram reportados como **SKIP/NÃO EXECUTADOS**, não como aprovados.
3. O navegador do ambiente bloqueia navegação para `127.0.0.1`; `production-browser-smoke.py` registra **NÃO EXECUTADO** por `ERR_BLOCKED_BY_ADMINISTRATOR`. Como cobertura alternativa, o mesmo `dist` passou no smoke HTTP de 8 cenários e no browser regression de 18 larguras sem servidor loopback.
4. Integrações reais de PostgreSQL, SMTP, Mercado Pago, Correios e Jadlog exigem credenciais/serviços externos e devem ser validadas no ambiente de implantação.
