const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.pem': 'application/x-pem-file',
};

const HOST = '0.0.0.0';
const PORT = 8765;

const keyPath = path.join(ROOT, 'certs', 'server.key');
const certPath = path.join(ROOT, 'certs', 'server.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Certificado não encontrado em certs/. Rode certs/gerar-certificado.sh primeiro.');
  process.exit(1);
}

function getLocalIp() {
  try {
    return execSync('ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null')
      .toString().trim();
  } catch {
    return null;
  }
}

function getLocalHostname() {
  try {
    const name = execSync('scutil --get LocalHostName 2>/dev/null').toString().trim();
    return name ? `${name}.local` : null;
  } catch {
    return null;
  }
}

https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  (req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    // certs/ guarda chaves privadas — nunca deve ser servido pela própria URL do app.
    if (rel.startsWith('/certs/')) { res.writeHead(403); return res.end('forbidden'); }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }
).listen(PORT, HOST, () => {
  const ip = getLocalIp();
  const host = getLocalHostname();
  console.log(`GRANA — Finanças rodando em https://localhost:${PORT}`);
  if (host) console.log(`No iPhone (endereço fixo, use este): https://${host}:${PORT}`);
  if (ip) console.log(`No iPhone (por IP, muda de rede em rede): https://${ip}:${PORT}`);
  console.log('Se o certificado ainda não foi confiado no iPhone, veja LEIA-ME.md.');
});
