# Enviar as melhorias v9.6.2 pelo SITE do GitHub (sem programar nada)

Você já fez isso uma vez, quando subiu o projeto pela primeira vez ("Add
files via upload"). É o mesmo processo — só que agora os arquivos vão para
as pastas certas.

## Antes de começar

1. Baixe o arquivo **enviar-ao-github-v9.6.2.zip** (está na raiz do projeto
   aqui na sessão — clique nele na lista de arquivos e baixe).
2. **Descompacte** o ZIP numa pasta do seu computador. Vai aparecer:
   - 4 arquivos soltos: `.env.example`, `MANIFEST.sha256`, `package.json`,
     `package-lock.json`, `server.js`
   - pastas: `public/`, `src/`, `tests/`

## Passo a passo no site do GitHub

1. Abra **github.com/rrafsleal-alt/INTEGRALL** e faça login.
2. Clique no botão **Add file ▾ → Upload files** (fica perto do botão verde
   "Code").
3. **Arraste TODO o conteúdo da pasta descompactada** para a área de upload
   — incluindo as pastas `public`, `src` e `tests` inteiras. O GitHub
   mantém a estrutura de pastas automaticamente quando você arrasta pastas.
   ⚠️ Importante: arraste as PASTAS, não entre nelas para arrastar arquivo
   por arquivo.
4. Em "Commit changes", escreva na primeira caixa:
   `Admin: Personalização completa + produtos/variações + correções (v9.6.2)`
5. Deixe marcado **"Commit directly to the main branch"**.
6. Clique no botão verde **Commit changes**.

O GitHub vai SUBSTITUIR os arquivos existentes pelos novos (é o que
queremos) e adicionar os que não existiam.

## Conferir que deu certo

- Abra o arquivo `package.json` no GitHub: a linha `"version"` deve dizer
  **9.6.2**.
- Se o site estiver no Render, ele fará o deploy automático em alguns
  minutos com tudo novo.

## O que este pacote contém

- 🎨 Aba Personalização no Admin (textos, 31 cores, fontes, logos, layout,
  mostrar/ocultar)
- ➕ Criar/excluir produtos e variações direto no painel
- 🔐 Login do Admin corrigido (funciona em qualquer navegador/proxy,
  login por link /admin?token=…)
- 💰 5 correções financeiras (erro de 100x no preço, teto de desconto,
  frete por zonas, replay de pedido pago, trava de 30kg)
- ⏱️ Correção de concorrência (pedido pago nunca é cancelado pela limpeza
  automática)
- 🧪 78 testes automatizados (3 novos)
