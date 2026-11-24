// Weekly off-site backup of Safar's user data (trips, accounts, live trips).
// Reads everything through the server's read-only export, then compresses and encrypts it
// (AES-256-GCM, key from the BACKUP_KEY secret). Only someone with BACKUP_KEY can read the file.
//   node backup.js                → writes backup/safar-YYYY-MM-DD.bin
//   node backup.js --decrypt FILE → prints the counts inside a backup (restore check)
const fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const API = process.env.SAFAR_API || 'https://safar-api.hamid-ebb.workers.dev';
const PREFIXES = ['user:', 'trip:', 'trip-prev:', 'live:', 'pro:', 'cus:'];
const keyOf = (pass, salt) => crypto.scryptSync(pass, salt, 32);
function seal(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([Buffer.from('SAFARBK1'), salt, iv, c.getAuthTag(), body]);
}
function open(buf, pass) {
  if (buf.subarray(0, 8).toString() !== 'SAFARBK1') throw new Error('not a Safar backup');
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52), d = crypto.createDecipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  d.setAuthTag(tag); return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(52)), d.final()])));
}
async function githubToken() {   // GitHub's signed proof that this is the Safar backup job (needs permissions: id-token: write)
  const r = await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=safar-backup', { headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } });
  if (!r.ok) throw new Error('could not get GitHub token: ' + r.status); return (await r.json()).value;
}
async function exportAll(key) {
  const out = { at: new Date().toISOString(), items: [] };
  for (const prefix of PREFIXES) {
    let cursor = '', pages = 0;
    do {
      const r = await fetch(`${API}/admin/export?prefix=${encodeURIComponent(prefix)}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { headers: key ? { 'X-Admin-Key': key } : { Authorization: 'Bearer ' + await githubToken() } });
      if (!r.ok) throw new Error(`export ${prefix} failed: ${r.status} ${await r.text()}`);
      const j = await r.json(); out.items.push(...j.items); cursor = j.cursor; if (++pages > 500) throw new Error('too many pages');
    } while (cursor);
  }
  return out;
}
const counts = d => Object.fromEntries(PREFIXES.map(p => [p.slice(0, -1), d.items.filter(x => x.k.startsWith(p)).length]));
module.exports = { seal, open, exportAll, counts };
if (require.main === module) (async () => {
  const pass = process.env.BACKUP_KEY; if (!pass || pass.length < 20) throw new Error('BACKUP_KEY missing');
  if (process.argv[2] === '--decrypt') { const d = open(fs.readFileSync(process.argv[3]), pass); console.log('backup from', d.at, counts(d)); return; }
  const d = await exportAll(process.env.SAFAR_ADMIN_KEY || ''), buf = seal(d, pass);
  const back = open(buf, pass); if (back.items.length !== d.items.length) throw new Error('backup check failed');   // prove it decrypts before keeping it
  fs.mkdirSync('backup', { recursive: true }); const f = `backup/safar-${d.at.slice(0, 10)}.bin`; fs.writeFileSync(f, buf);
  console.log('saved', f, buf.length, 'bytes', counts(d));
})().catch(e => { console.error(e.message); process.exit(1); });
