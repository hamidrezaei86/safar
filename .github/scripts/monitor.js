// Safar health check (run by .github/workflows/monitor.yml)
const API = 'https://safar-api.hamid-ebb.workers.dev';
const UA = { 'User-Agent': 'Safar-monitor/1.0 (+https://safar.amovasolutions.com/)' };
const CHECKS = [
  ['Safar app page', 'https://safar.amovasolutions.com/', r => r.ok],
  ['Safar server', API + '/health', async r => (await r.json()).ok === true],
  ['Claude/ChatGPT connector', API + '/mcp', async r => ((await r.json()).tools || []).includes('plan_trip')],
  ['Map tiles (OpenFreeMap)', 'https://tiles.openfreemap.org/styles/liberty', r => r.ok],
  ['Place search (Photon)', 'https://photon.komoot.io/api/?q=Rome&limit=1', async r => ((await r.json()).features || []).length > 0],
  ['Place search backup (Nominatim)', 'https://nominatim.openstreetmap.org/search?q=Rome&format=json&limit=1', async r => (await r.json()).length > 0],
  ['Walking routes (FOSSGIS OSRM)', 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/12.4922,41.8902;12.4769,41.8986?overview=false', async r => (await r.json()).code === 'Ok'],
  ['Driving routes backup (OSRM demo)', 'https://router.project-osrm.org/route/v1/driving/12.4922,41.8902;12.4769,41.8986?overview=false', async r => (await r.json()).code === 'Ok'],
  ['Backup map style (VersaTiles)', 'https://tiles.versatiles.org/assets/styles/colorful/style.json', r => r.ok],
  ['Cafés & restaurants (Overpass — any of 4 mirrors)', 'overpass', null],
  ['Sights (Wikipedia)', 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=nearcoord:2km,41.89,12.49&format=json', async r => ((await r.json()).query?.search || []).length > 0],
  ['Weather (Open-Meteo)', 'https://api.open-meteo.com/v1/forecast?latitude=41.9&longitude=12.5&daily=weathercode&forecast_days=1', r => r.ok],
  ['Flight lookup (adsbdb)', 'https://api.adsbdb.com/v0/callsign/AZ610', r => r.status < 500],
  ['Map library (cdnjs)', 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js', r => r.ok],
];
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const Q = 'data=' + encodeURIComponent('[out:json][timeout:15];node(41.8985,12.4760,41.8995,12.4775)[amenity];out 1;');
async function probe([name, url, ok]) {
  if (url === 'overpass') {                                             // Safar's server tries all four mirrors, so only all four down is an outage
    for (let i = 0; i < 2; i++) { const r = await Promise.any(OVERPASS.map(u => fetch(u, { method: 'POST', body: Q, headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(25000) })
      .then(async x => x.ok && (await x.text()).trimStart().startsWith('{') ? true : Promise.reject()))).catch(() => false); if (r) return null; await new Promise(r => setTimeout(r, 5000)); }
    return name;
  }
  for (let i = 0; i < 2; i++) {                                         // one retry: public services blip
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) }); if (await ok(r)) return null; } catch (e) {}
    await new Promise(r => setTimeout(r, 5000));
  }
  return name;
}
module.exports = async ({ github, context, core }) => {
  const down = (await Promise.all(CHECKS.map(probe))).filter(Boolean);
  let status = null; try { status = await (await fetch(API + '/status', { headers: UA })).json(); } catch (e) {}
  const high = status ? Object.entries(status.usedPercent || {}).filter(([, p]) => p >= 70) : [];
  const errs = (status?.errors?.list || []).filter(e => !e.test);
  const lines = [];
  if (down.length) lines.push('### Not responding\n' + down.map(d => `- ${d}`).join('\n'));
  if (high.length) lines.push('### Cloudflare free plan nearly used up today\n' + high.map(([k, p]) => `- ${k}: about ${p}%`).join('\n') + '\n\nIf this keeps happening, upgrade to Workers Paid (US$5/month): Cloudflare dashboard → Workers & Pages → Plans.');
  if (errs.length) lines.push(`### App errors today (${errs.reduce((n, e) => n + e.n, 0)})\n` + errs.slice(0, 10).map(e => `- **${e.m}** ×${e.n} — \`${(e.at || '').trim()}\` (version ${e.v || '?'})`).join('\n'));
  core.summary.addRaw(lines.join('\n\n') || 'All good.').write();
  const { owner, repo } = context.repo, label = 'safar-alert';
  const open = (await github.rest.issues.listForRepo({ owner, repo, labels: label, state: 'open' })).data;
  if (!lines.length) {                                                  // all good: close any open alert
    for (const i of open) { await github.rest.issues.createComment({ owner, repo, issue_number: i.number, body: 'Everything is working again.' }); await github.rest.issues.update({ owner, repo, issue_number: i.number, state: 'closed' }); }
    return;
  }
  const body = lines.join('\n\n') + `\n\n_Checked ${new Date().toUTCString()} · full status: ${API}/status_`;
  const title = 'Safar needs attention: ' + [down.length && 'service down', high.length && 'usage high', errs.length && 'app errors'].filter(Boolean).join(', ');
  if (open[0]) { if (open[0].body !== body) await github.rest.issues.update({ owner, repo, issue_number: open[0].number, title, body }); if (open[0].title !== title) await github.rest.issues.createComment({ owner, repo, issue_number: open[0].number, body: 'Update: ' + title }); }
  else await github.rest.issues.create({ owner, repo, title, body, labels: [label] });
};
