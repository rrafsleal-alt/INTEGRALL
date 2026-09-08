# Relatório de build — INTEGRALL v11.1.1

Data: 2 de setembro de 2026.

## Resultado executado

- `npm run catalog:embed`: **APROVADO** — 5 produtos vendáveis sincronizados no fallback seguro.
- `npm run check`: **APROVADO** — 56 arquivos JavaScript verificados.
- `npm run audit`: **APROVADO** — catálogo, assets, HTML e pacote validados.
- `npm run build`: **APROVADO** — staging determinístico em `dist/`.
- Saída: **289 arquivos**, **16.680.526 bytes** e **288 hashes** em `BUILD-MANIFEST.sha256`, todos revalidados byte a byte.
- `npm run test:production:http`: **APROVADO** — 8 cenários do build servido por HTTP e 288 hashes verificados.
- `npm run test:browser:production`: **APROVADO** — conteúdo real de `dist/` exercitado em Chromium nas 18 larguras da matriz.

O `dist/` contém servidor Node, fontes, assets, catálogo, migrations, lockfile e configuração de exemplo, sem `node_modules`, `.git`, `.env` real ou credenciais.

## Limitações do ambiente

A tentativa de instalação limpa com `npm ci` não concluiu porque o ambiente não conseguiu resolver o registry npm (`EAI_AGAIN`). O build não dependeu de pacotes instalados porque suas verificações foram construídas sobre módulos nativos; entretanto, os 15 testes HTTP do Express permanecem **NÃO EXECUTADOS** neste ambiente. O acesso de Chromium ao servidor de loopback também foi bloqueado por política (`ERR_BLOCKED_BY_ADMINISTRATOR`); por isso, a validação de navegador do `dist` foi feita com os arquivos reais carregados diretamente, enquanto o serviço HTTP foi validado separadamente pelo smoke Node.
