# GRANA como app (Android e iPhone)

O GRANA continua sendo o mesmo código do site. O **Capacitor** "embrulha" esse código num app de verdade,
que vai para a Play Store e para a App Store. O site no Vercel não muda nada com isso.

## O que é diferente dentro do app

Tudo fica em `src-app/nativo.js` e só é usado no app:

- **Trava com Face ID / digital** pela biometria do próprio celular (no lugar do WebAuthn do navegador).
- **Lembrete das 21h** como notificação local: funciona com o app fechado e sem servidor.
- **Links externos** abrem no navegador do celular.
- **Botão voltar do Android** fecha a janela aberta, volta para o Resumo ou minimiza o app.
- **Barra de status** acompanha o tema claro/escuro; tela de abertura com a cor do app.

## Pastas novas

- `android/` e `ios/`: os projetos nativos (abrem no Android Studio e no Xcode).
- `src-app/`: a camada nativa.
- `scripts/montar-app.js`: monta a pasta `www/` (cópia do site + camada nativa) que vai para dentro do app.
- `capacitor.config.json`: nome e identificador do app.

`www/` é gerada automaticamente e não vai para o Git. O `.vercelignore` impede que essas pastas sejam publicadas no site.

## Comandos (no Terminal do Mac, dentro da pasta GRANA)

| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências (uma vez, ou quando mudar o package.json) |
| `npm run app:android` | Monta o app e abre no **Android Studio** |
| `npm run app:ios` | Monta o app e abre no **Xcode** |
| `npm run app:sync` | Só atualiza os dois apps depois de mudar o código |

Sempre que mudar `index.html`, `css/` ou `js/`, rode `npm run app:sync` (ou um dos comandos acima) para o app receber a mudança.

## Programas necessários no Mac

- **Android Studio** (grátis): https://developer.android.com/studio
- **Xcode** (grátis, na App Store do Mac)

## Antes de publicar

- Confirmar o identificador do app em `capacitor.config.json` (hoje `br.com.grana.app`). **Depois da primeira publicação ele não muda mais.**
- Gerar ícones e tela de abertura a partir do logo em 1024×1024 (`npx @capacitor/assets generate`).
