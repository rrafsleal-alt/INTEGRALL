# TEST_REPORT — INTEGRALL v11.1.1

Ambiente: Linux x86_64, Node.js 22.16.0, npm 10.9.2, Python 3.13.5 e Chromium 144.0.7559.96, em 02/09/2026.

## Resultados realmente executados

| Comando/cenário | Status | Resultado |
|---|---|---|
| `npm run check` | APROVADO | 56 arquivos JavaScript; 0 falhas |
| `npm run test:dependency-free` | APROVADO | 121/121; 0 falhas |
| `npm test` | APROVADO COM SKIPS DECLARADOS | 136 total; 121 aprovados; 15 SKIP; 0 falhas |
| `npm run admin:check-default` | APROVADO | credencial inicial correta aceita com e-mail em branco; valor não impresso |
| `npm run security:scan` | APROVADO | 85 arquivos; 2 avisos TLS informativos |
| `npm run audit` | APROVADO | 227 produtos, 52 variações e 227 referências de imagem |
| `npm run build` | APROVADO | 289 arquivos; 16.680.526 bytes; manifesto revalidado |
| `npm run test:production:http` | APROVADO | 8 cenários; 288 hashes do build verificados |
| `npm run test:browser` | APROVADO | loja: 18/18 larguras |
| `npm run test:browser:admin` | APROVADO | login inválido/válido/logout e Admin: 18/18 larguras |
| `npm run test:browser:production` | APROVADO | arquivos reais de `dist/`: 18/18 larguras |
| Chromium sobre HTTP de loopback | NÃO EXECUTADO | política do ambiente bloqueou `127.0.0.1` |
| `npm ci` limpo | NÃO EXECUTADO | tentativa bloqueada por DNS `EAI_AGAIN` |
| `npm audit` online | NÃO EXECUTADO | registry indisponível |
| PostgreSQL/MP/Correios/Jadlog/SMTP reais | NÃO EXECUTADO | sem serviços/credenciais |
| Firefox/WebKit/Safari | NÃO EXECUTADO | mecanismos ausentes |

A versão atual não mantém uma senha administrativa concorrente: quando `ADMIN_PASSWORD_HASH` é configurado, ele substitui integralmente a credencial inicial. Produção recusa a credencial inicial e exige segredos persistentes.

Consulte `TESTES-V11.1.1.md` para a matriz detalhada e `docs/evidencias-v11.1.1/` para JSON, capturas e logs.
