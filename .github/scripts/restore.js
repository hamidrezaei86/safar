// Puts a backup back on the Safar server. By default only fills in what is missing (never overwrites newer data).
//   BACKUP_KEY=… SAFAR_ADMIN_KEY=… node restore.js backup/safar-2026-11-29.bin [--overwrite]
const fs = require('fs'), { open, counts } = require('./backup.js');
const API = process.env.SAFAR_API || 'https://safar-api.hamid-ebb.workers.dev';
(async () => {
  const d = open(fs.readFileSync(process.argv[2]), process.env.BACKUP_KEY), over = process.argv.includes('--overwrite'); let n = 0;
  console.log('restoring backup from', d.at, counts(d));
  for (let i = 0; i < d.items.length; i += 200) {
    const r = await fetch(API + '/admin/import', { method: 'POST', headers: { 'X-Admin-Key': process.env.SAFAR_ADMIN_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: d.items.slice(i, i + 200), onlyMissing: !over }) });
    if (!r.ok) throw new Error(`import failed: ${r.status} ${await r.text()}`); n += (await r.json()).restored;
  }
  console.log('restored', n, 'records');
})().catch(e => { console.error(e.message); process.exit(1); });
