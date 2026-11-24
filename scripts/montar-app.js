/* Monta a pasta www/ que vira o app (Android e iPhone).
   O site no Vercel continua usando os arquivos da raiz, sem nenhuma mudança:
   só a cópia em www/ recebe a camada nativa (src-app/nativo.js).

   Uso: npm run app:montar   (ou npm run app:sync para montar e já copiar para android/ e ios/) */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild-wasm'); // versão sem binário nativo: funciona igual no Mac, Windows e Linux

const raiz = path.join(__dirname, '..');
const www = path.join(raiz, 'www');

const COPIAR = ['index.html', 'manifest.json', 'css', 'js', 'icons', 'fonts'];

async function montar() {
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
// Cópia simples (só o conteúdo dos arquivos), que funciona em qualquer pasta, inclusive sincronizada.
function copiar(origem, destino) {
  if (fs.statSync(origem).isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const nome of fs.readdirSync(origem)) {
      if (nome === '.DS_Store') continue;
      copiar(path.join(origem, nome), path.join(destino, nome));
    }
  } else {
    fs.writeFileSync(destino, fs.readFileSync(origem));
  }
}
for (const item of COPIAR) copiar(path.join(raiz, item), path.join(www, item));

// Camada nativa: um arquivo só, com os plugins do Capacitor embutidos.
await esbuild.build({
  entryPoints: [path.join(raiz, 'src-app', 'nativo.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020', // Capacitor 8 exige iOS 15+ e Android com WebView atual
  minify: true,
  outfile: path.join(www, 'js', 'nativo.js'),
  logLevel: 'warning',
});

// Carrega a camada nativa logo depois do app.js (os dois com defer, então nessa ordem).
const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const marcador = '<script src="js/app.js" defer></script>';
if (!html.includes(marcador)) throw new Error('Não achei a tag do app.js no index.html');
html = html.replace(marcador, `${marcador}\n<script src="js/nativo.js" defer></script>`);
// Dentro do app o manifest de PWA não serve para nada
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
fs.writeFileSync(indexPath, html);

console.log('www/ montada: pronta para "npx cap sync".');
}

montar().catch((err) => { console.error(err); process.exit(1); });
