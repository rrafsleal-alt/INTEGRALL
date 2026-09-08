# AUDIT_BASELINE — estado original recebido

Data da inspeção: 30/08/2026 (America/Sao_Paulo)

## Preservação e origem

- Arquivo recebido: `1a5e747d-feb9-476f-9e94-14da93e27ab4(2).rar` (RAR5).
- SHA-256 do original: `1d318aafbb71ce4819c5efaebba33e973cde3b583891bac712dbce4b8978015f`.
- O arquivo original foi preservado fora da árvore de trabalho.
- Extração segura: 1.488 entradas; nenhuma entrada absoluta, `..`, link simbólico ou arquivo especial foi aceita.
- Raiz real: `INTEGRALL-main`.
- O pacote não continha histórico Git. Foi criado um repositório local na branch `audit/premium-hardening` somente para rastrear a intervenção; o conteúdo original permanece preservado em cópia separada.

## Inventário técnico inicial

- Runtime declarado: Node.js `>=20.12 <27`; runtime de auditoria: Node.js `22.16.0`, npm `10.9.2`.
- Aplicação: Express 5, JavaScript ESM, HTML/CSS/JavaScript sem framework de frontend.
- Persistência: PostgreSQL via `pg`, com fallback local/memória fora de produção.
- Pagamento: integração direta com Mercado Pago Checkout Pro.
- Frete: Correios e Jadlog implementados diretamente em services.
- Administração: página estática `/admin` e rotas `/api/admin/*`.
- Catálogo: JSON normalizado e armazenado integralmente em JSONB.
- Testes: Node Test Runner, 9 arquivos de teste.
- Não havia script de build, lint real, typecheck, migrations versionadas, CI ou suíte E2E de navegador.

## Comandos e resultados iniciais

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | interrompido pelo ambiente | DNS/registry indisponível; o pacote recebido já incluía `node_modules` e ele foi usado apenas para estabelecer o baseline. |
| `npm run check` | 0 | Verificação sintática aprovada. |
| `npm test` | 1 | 87 testes executados: 86 aprovados e 1 reprovado. |
| `npm run audit` | 0 | Auditoria interna superficial aprovada. |
| `npm audit --omit=dev --audit-level=low` | 1 | Não executável: `getaddrinfo EAI_AGAIN registry.npmjs.org`. |

### Teste reprovado

`tests/http.test.js` esperava `401` ao criar produto sem credencial administrativa, porém a API retornou `201`. A causa estava explícita em `server.js`: o middleware administrativo era `(_req, _res, next) => next()`.

## Falhas confirmadas no baseline

### P0 — bloqueador crítico

1. **Administração totalmente sem autenticação e autorização**
   - Qualquer pessoa com acesso ao site podia listar clientes e pedidos, alterar status, preços, estoque, catálogo, cupons, imagens e excluir produtos.
   - Ocultar `/admin` por três cliques não constitui controle de acesso.
   - A própria resposta de `/api/health` divulgava o método de acesso administrativo.

### P1 — alta prioridade

1. Upload em JSON/base64 em vez de multipart, sem limite de pixels/dimensões, sem metadados de mídia, sem exclusão segura e sem limpeza de órfãos.
2. Alteração de status de pedido aceitava qualquer status conhecido, sem validar transições permitidas.
3. Schema era criado/adaptado durante o boot, sem migrations versionadas ou histórico de aplicação.
4. Conexão PostgreSQL de produção usava `rejectUnauthorized: false` de forma fixa.
5. Painel não tinha login, logout, sessão, proteção CSRF, papéis, trilha de autenticação ou proteção específica contra força bruta.

### P2 — prioridade média

1. Endpoint de saúde expunha detalhes internos desnecessários.
2. IDs de produto e mídia usavam `Date.now()` + `Math.random()`.
3. Upload não armazenava checksum, dimensões, tamanho, alt text, usuário, estado de processamento ou referência lógica.
4. Não havia API de remoção de mídia com proteção contra exclusão de arquivo em uso.
5. Ausência de headers de request ID e padrão consistente de erro com código/rastreio.
6. Ausência de pipeline CI, lint semântico, format check, coverage e testes E2E reais.
7. Administração carregava até 300 registros sem paginação real.
8. Vários `catch {}` silenciosos e logs não estruturados.
9. Não havia documentação operacional suficiente para autenticação segura, migrations e rollback.

## Estado visual inicial

A validação HTTP foi possível. A captura por Chromium do sistema foi bloqueada pela política administrada do próprio ambiente (`URLBlocklist: ["*"]`), portanto nenhuma pontuação Lighthouse/axe ou screenshot de navegador do baseline foi fabricada. Essa limitação ambiental deve permanecer explícita no relatório final; as validações responsivas serão complementadas por inspeção CSS/DOM, testes automatizados de regras de layout e, quando possível, um harness de renderização sem navegação externa.

## Segredos e conteúdo empacotado

- O RAR continha `.env` e `node_modules`.
- Os campos sensíveis do `.env` estavam vazios no arquivo inspecionado; nenhum valor foi exposto no relatório.
- `.env`, `node_modules`, estado local, bancos, caches e segredos não serão incluídos no pacote final.
