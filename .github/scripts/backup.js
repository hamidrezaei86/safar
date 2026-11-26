// Weekly off-site backup of Safar's user data (trips, accounts, live trips).
// Reads everything through the server's read-only export, then compresses and encrypts it
// with a fresh AES-256-GCM key each time; that key is locked with Safar's backup PUBLIC key (.github/backup-public-key.pem).
// No secret is stored on GitHub: only the matching PRIVATE key, kept by Hamid off GitHub, can open a backup.
//   node backup.js                                  → writes backup/safar-YYYY-MM-DD.bin
//   node backup.js --decrypt FILE PRIVATE_KEY.pem   → prints the counts inside a backup (restore check)
const fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const API = process.env.SAFAR_API || 'https://safar-api.hamid-ebb.workers.dev';
const PREFIXES = ['user:', 'trip:', 'trip-prev:', 'btrip:', 'live:', 'pro:', 'cus:', 'org:', 'orgof:', 'orep:', 'obook:', 'rcpt:'];
const keyOf = (pass, salt) => crypto.scryptSync(pass, salt, 32);
function seal(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(pass, salt), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([Buffer.from('SAFARBK1'), salt, iv, c.getAuthTag(), body]);
}
const PUB = () => fs.readFileSync(require('path').join(__dirname, '..', 'backup-public-key.pem'));
const OAEP = k => ({ key: k, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' });
function sealPub(obj, pub) {   // SAFARBK2: random AES key, wrapped with the RSA-4096 public key
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]), wrapped = crypto.publicEncrypt(OAEP(pub), key);
  const len = Buffer.alloc(2); len.writeUInt16BE(wrapped.length);
  return Buffer.concat([Buffer.from('SAFARBK2'), len, wrapped, iv, c.getAuthTag(), body]);
}
function open(buf, pass) {
  if (buf.subarray(0, 8).toString() === 'SAFARBK2') {   // pass = the private key (PEM text)
    const n = buf.readUInt16BE(8), key = crypto.privateDecrypt(OAEP(pass), buf.subarray(10, 10 + n)), o = 10 + n;
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(o, o + 12)); d.setAuthTag(buf.subarray(o + 12, o + 28));
    return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(o + 28)), d.final()])));
  }
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
module.exports = { seal, sealPub, open, exportAll, counts };
if (require.main === module) (async () => {
  if (process.argv[2] === '--decrypt') { const d = open(fs.readFileSync(process.argv[3]), fs.readFileSync(process.argv[4] || process.env.BACKUP_PRIVATE_KEY_FILE)); console.log('backup from', d.at, counts(d)); return; }
  const d = await exportAll(process.env.SAFAR_ADMIN_KEY || ''), buf = sealPub(d, PUB());
  if (!(buf.length > 600) || buf.subarray(0, 8).toString() !== 'SAFARBK2') throw new Error('backup check failed');
  fs.mkdirSync('backup', { recursive: true }); const f = `backup/safar-${d.at.slice(0, 10)}.bin`; fs.writeFileSync(f, buf);
  console.log('saved', f, buf.length, 'bytes', counts(d));
})().catch(e => { console.error(e.message); process.exit(1); });
