# INTEGRALL v11.1.3 — revisão de UX, imagens e rolagem

## Objetivo

Corrigir atritos pequenos, porém essenciais, relatados após a v11.1.2: sensação de popup travado, desfoque excessivo do fundo, imagens com bordas/áreas vazias, ausência de navegação entre fotos sem abrir o produto e rolagem pouco natural no Admin.

## Correções implementadas

### Popup do produto
- removido `backdrop-filter: blur(...)`;
- overlay reduzido para escurecimento leve, sem borrar a loja;
- o próprio popup é o contêiner de rolagem, eliminando rolagem interna aninhada;
- roda do mouse sobre o fundo do popup é encaminhada ao conteúdo do produto;
- abertura continua sem alterar `window.scrollY`;
- fechamento por X, clique fora e Escape preservado;
- foco e bloqueio de fundo permanecem acessíveis.

### Imagens dos produtos
- cards em proporção quadrada;
- borda removida;
- camada principal usa `contain`, portanto a foto do produto não é cortada;
- camada de preenchimento usa a mesma foto com `cover` e baixa opacidade, preenchendo o quadrado sem criar faixas vazias;
- fallback de imagem quebrada preservado.

### Carrossel
- setas anterior/próxima diretamente no card;
- navegação sem abrir o produto;
- gesto horizontal em dispositivos touch;
- teclado nas áreas focáveis;
- contador/indicadores aparecem apenas quando existem 2+ fotos;
- popup possui os mesmos controles;
- seleção de variação continua saltando para a foto associada.

### Admin
- removidas alturas rígidas e rolagens aninhadas do editor visual;
- painel passa a usar a rolagem normal da página;
- prévia fica sticky em desktop e volta ao fluxo normal em telas menores;
- roda do mouse sobre o iframe da prévia é encaminhada ao Admin quando necessário;
- `Shift + roda` permite rolar somente a prévia;
- upload múltiplo continua copiando o `FileList` antes de limpar o input.

## Varredura adicional
- referências públicas atualizadas com cache-busting v11.1.3;
- auditoria estrutural ajustada para a nova arquitetura de rolagem;
- build de produção regenerado;
- scanner de segurança executado;
- catálogo auditado com 227 produtos e 52 variações;
- nenhuma função comercial foi removida.

## Validação executada
- `npm run check`: 60 arquivos JavaScript válidos;
- `npm run test:dependency-free`: 138/138 aprovados;
- `npm test`: 153 cenários, 138 aprovados, 15 SKIP dependentes de ambiente/serviços, 0 falhas;
- `npm audit --offline`: 0 vulnerabilidades conhecidas no lockfile disponível;
- loja Chromium: 18/18 larguras (280–2560 px);
- Admin Chromium: 18/18 larguras, login/logout, overflow=0 e console errors=0;
- galeria Admin: 2 arquivos selecionados juntos, 2 uploads, 3 fotos persistidas e vínculo de variação confirmado;
- build: 292 arquivos, manifesto verificado;
- smoke HTTP: 8/8 cenários;
- build em Chromium: 18/18 larguras.

## Observação do catálogo
A funcionalidade de foto por variação existe e foi testada, mas o catálogo entregue atualmente possui 0 variações já preenchidas com uma foto específica. A associação precisa ser feita no Admin conforme as fotos reais forem adicionadas a cada produto.
