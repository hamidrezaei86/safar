// Copies the web app (repo root) into www/ for the iPhone and Android builds.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), www = path.join(__dirname, '..', 'www');
fs.mkdirSync(www, { recursive: true });
for (const f of ['index.html', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'auth.html']) fs.copyFileSync(path.join(root, f), path.join(www, f));
fs.mkdirSync(path.join(www, 'img'), { recursive: true }); for (const f of ['powered-by-transit.svg']) fs.copyFileSync(path.join(root, 'img', f), path.join(www, 'img', f));   // badges and pictures the app shows (e.g. Powered by Transit)
console.log('Copied web app into www/');
