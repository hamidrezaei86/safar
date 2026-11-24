// Copies the web app (repo root) into www/ for the iOS build.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), www = path.join(__dirname, '..', 'www');
fs.mkdirSync(www, { recursive: true });
for (const f of ['index.html', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'auth.html']) fs.copyFileSync(path.join(root, f), path.join(www, f));
console.log('Copied web app into www/');
