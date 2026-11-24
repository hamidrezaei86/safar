// Shared setup: the page runs fully offline. Outside services are replaced with small fixtures,
// so tests are fast, repeatable and never touch real accounts or the real Safar server.
const path = require('path'), fs = require('fs');
const FX = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const ML = path.join(__dirname, 'node_modules/maplibre-gl/dist');
async function offline(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost:8080/')) return route.fallback();
    if (/maplibre-gl\.min\.js$/.test(u)) return route.fulfill({ path: path.join(ML, 'maplibre-gl.js'), contentType: 'text/javascript' });
    if (/maplibre-gl\.min\.css$/.test(u)) return route.fulfill({ path: path.join(ML, 'maplibre-gl.css'), contentType: 'text/css' });
    if (u.includes('tiles.openfreemap.org/styles')) return route.fulfill({ body: FX('style.json'), contentType: 'application/json' });
    if (u.includes('photon.komoot.io/api') && /q=rom/i.test(u)) return route.fulfill({ body: FX('photon-rome.json'), contentType: 'application/json' });
    if (u.includes('photon.komoot.io') || u.includes('nominatim')) return route.fulfill({ body: '{"type":"FeatureCollection","features":[]}', contentType: 'application/json' });
    if (u.includes('safar-api.hamid-ebb.workers.dev')) return route.fulfill({ status: opts.api || 503, body: '{"error":"offline in tests"}', contentType: 'application/json' });
    return route.abort();
  });
  return errors;
}
const open = (page, q = '') => page.goto((process.env.SAFAR_PAGE || '') + '?test=1' + q);
module.exports = { offline, open };
