# Como levar as melhorias v9.6.2 para o GitHub

Este pacote contém TODO o trabalho feito após o merge do PR #2:

## O que está incluído (866 linhas adicionadas, 17 arquivos)

1. **🎨 Aba Personalização completa no Admin** — textos, 31 cores, fontes,
   logos/imagens, layout/posição dos elementos e mostrar/ocultar, com
   endpoints GET/PUT /api/admin/settings.
2. **➕ Criar/excluir produtos e variações no Admin** — botão "Novo produto",
   "Adicionar variação", "Excluir produto", campo de foto/departamento/marca,
   endpoints POST/DELETE /api/admin/products.
3. **🔐 Login do Admin corrigido** — token em memória (previews/iframes que
   bloqueiam sessionStorage), login por link /admin?token=…, cabeçalho
   redundante X-Admin-Token (proxies que engolem Authorization), painel de
   login some ao entrar ([hidden] !important), diagnóstico ADMIN_AUTH_DEBUG
   sem vazar conteúdo do token.
4. **💰 Correções financeiras** — parseReais sem erro de 100x ("28.50"),
   desconto do carrinho com o mesmo teto do servidor (mínimo R$ 1,00),
   frete por zonas lendo o formato do servidor, replay idempotente de pedido
   pago não oferece novo pagamento, caixa >30kg dispara trava em vez de
   cotar errado.
5. **⏱️ TOCTOU no cancelamento automático** — expiração reconfirma o status
   dentro do lock (pedido pago nunca é sobrescrito por cancelamento).
6. **🧪 78 testes (3 novos)** + versão 9.6.2 + cache-busting da loja.

## Passo a passo (na NOVA sessão de código do Arena)

Abra uma nova sessão neste repositório (rrafsleal-alt/INTEGRALL) e peça:

> "Aplique o patch integrall-melhorias-v9.6.2.patch que está na raiz do
> projeto (ou em docs/) sobre o main, rode npm install e npm run verify,
> e abra um PR com essas melhorias."

Ou, manualmente em qualquer computador com git:

```bash
git clone https://github.com/rrafsleal-alt/INTEGRALL.git
cd INTEGRALL
git checkout -b melhorias-v9.6.2
git apply caminho/para/integrall-melhorias-v9.6.2.patch
npm install && npm run verify   # deve dar 78/78 e AUDIT OK
git add -A
git commit -m "Admin: Personalização completa + produtos/variações + correções (v9.6.2)"
git push origin melhorias-v9.6.2
# Abrir o Pull Request no site do GitHub e fazer o merge
```

O patch foi verificado: aplica limpo sobre o commit 75ebbdc (main atual).
