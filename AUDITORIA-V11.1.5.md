# INTEGRALL v11.1.5 — AUDITORIA DE COERÊNCIA

## Achados corrigidos

| ID | Severidade | Achado | Causa | Correção |
|---|---|---|---|---|
| UX-115-01 | P2 | Modal legal/status podia ficar fora do coordenador de camadas e alterar o scroll de forma incoerente | Implementação independente com `body.lock` próprio e sem backdrop autônomo | Coordenador único, backdrop próprio e sincronização do lock |
| DATA-115-02 | P2 | Política/Termos/Trocas perdiam parágrafos | Sanitizador genérico removia `\n` junto com controles proibidos | `cleanMultilineText` no servidor e frontend |
| QA-115-03 | P3 | Smoke de produção preso à string `11.1.4` | Versão literal no teste | Marcador derivado do `package.json` |
| QA-115-04 | P3 | Teste v11.1.4 gerava falso negativo após refatoração segura | Regex verificava forma interna antiga | Teste ajustado para contrato atual |
| QA-115-05 | P4 | Relatório Chromium podia duplicar a mesma falha de conta | `append` repetido | Duplicação removida |

## Itens revisados e mantidos

- 227 produtos e 52 variações.
- IDs de produto, slugs e IDs globais de variação sem duplicidades.
- Imagens referenciadas presentes no pacote.
- SKUs 331/332/333 continuam compartilhados porque essa duplicidade existe no material comercial de origem e SKU não é usado como identificador técnico único.
- O catálogo entregue ainda possui apenas uma foto por produto e zero vínculos reais de foto-variação; a funcionalidade para múltiplas fotos está implementada e foi validada no navegador, mas não foram inventadas imagens para os produtos.

## Riscos/limitações reais

- A verificação forense PDF → produto permanece **NÃO EXECUTADA** porque os PDFs-fonte não estão no pacote final.
- `DATABASE_SSL_MODE=require` permite TLS sem validação de certificado; produção deve preferir `verify-full`.
- A instalação limpa via registry npm não pôde ser concluída neste ambiente. A tentativa online ficou sem resposta até o timeout e `npm ci --offline` retornou `ENOTCACHED` para `xtend-4.0.2.tgz`. Por isso os testes HTTP que dependem dessas dependências permanecem SKIP/NÃO EXECUTADOS.
