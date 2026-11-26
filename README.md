# Casa em Ordem

App para celular que ajuda a arrumar a casa:

1. Tire uma foto do cômodo bagunçado.
2. O app envia a foto para o seu **Gemini** com um pedido pronto.
3. Cole a resposta do Gemini no app e ele vira um **checklist passo a passo**, com tempo estimado.
4. Peça ao Gemini a **imagem de como o cômodo vai ficar** e compare o antes e depois.

Funciona no **modo gratuito**: não usa chave de API. Usa o app do Gemini da própria pessoa.
Tudo fica salvo **só no celular** de cada pessoa.

## Instalar no celular
Abra o link do app no navegador e:
- **Android (Chrome):** menu ⋮ → *Adicionar à tela inicial* / *Instalar app*.
- **iPhone (Safari):** botão Compartilhar → *Adicionar à Tela de Início*.

## Publicar (GitHub Pages)
Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Arquivos
- `index.html`, `styles.css`, `app.js`: o app (sem dependências, sem etapa de build)
- `sw.js`, `manifest.webmanifest`, `icons/`: instalação e funcionamento offline
