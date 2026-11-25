// Safar end-to-end tests (phone size, fully offline — see helpers.js)
const { test, expect } = require('@playwright/test');
const { offline, open } = require('./helpers');
// Features that are on the staging copy only until they are published: their tests skip on the live page.
const stagingOnly = () => test.skip(!/staging/.test(process.env.SAFAR_PAGE || ''), 'staging-only feature (not published yet)');

async function skipWelcome(page) {
  await page.click('#welSkip');
  const not = page.locator('#welIn button', { hasText: 'Not now' }); if (await not.count()) await not.click();
  await expect(page.locator('#welSheet')).not.toHaveClass(/\bon\b/);
}
async function demoTrip(page) {
  await skipWelcome(page); await page.click('#gear'); await page.click('#sample'); await page.waitForLoadState('load');
  await expect(page.locator('#cityList')).toContainText('Roma');
}
async function axeViolations(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: require.resolve('axe-core') });
  return page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'], rules: { region: { enabled: false } } }))
    .violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')));
}

test('opens with no errors even when every outside service is down', async ({ page }) => {
  const errors = await offline(page); await open(page);
  await expect(page.locator('#welSheet')).toHaveClass(/\bon\b/);
  await expect(page.locator('#welIn h2')).toHaveText(/Welcome to safar/);
  await skipWelcome(page); await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test('adds a city from search', async ({ page }) => {
  await offline(page); await open(page); await skipWelcome(page);
  await page.fill('#dest', 'Rome');
  await page.locator('#destDrop div').first().click();
  await expect(page.locator('#cityList')).toContainText('Rome');
});

test('demo trip builds a day-by-day plan', async ({ page }) => {
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]');
  await expect(page.locator('#planOut')).toContainText('Day 1');
  await expect(page.locator('#planOut')).toContainText('Colosseum');
  await page.click('.step[data-step="go"]');
  await expect(page.locator('#goOut')).toContainText('Navigate to next stop');
  expect(errors).toEqual([]);
});

test('trip survives a reload and stays in test storage', async ({ page }) => {
  await offline(page); await open(page); await demoTrip(page);
  await page.reload(); await expect(page.locator('#cityList')).toContainText('Roma');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('roam_v2_test'); expect(keys).not.toContain('roam_v2');
});

test('share and export never include accounts or keys', async ({ page }) => {
  await offline(page); await open(page); await demoTrip(page);
  const t = await page.evaluate(() => { S.account = { email: 'a@b.c' }; S.links = [{ email: 'a@b.c', tok: 'x' }]; S.ai = { key: 'sk-secret' }; S.settings.gkey = 'AIzaSecret'; return JSON.stringify(tripForCloud()); });
  expect(t).not.toMatch(/sk-secret|AIzaSecret|a@b\.c/);
  const c = await page.evaluate(() => JSON.stringify(cleanTrip({ v: 2, cities: [{ name: '<img src=x onerror=alert(1)>', lat: 1, lng: 2 }], places: [], links: [1], ai: { key: 'k' }, account: {} })));
  expect(c).not.toMatch(/"links"|"ai"|"account"/);
});

test('settings work as a dialog from the keyboard', async ({ page }) => {
  await offline(page); await open(page); await skipWelcome(page);
  await page.focus('#gear'); await page.keyboard.press('Enter');
  const sheet = page.locator('#setSheet'); await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await page.keyboard.press('Escape'); await expect(sheet).not.toHaveClass(/\bon\b/);
});

test('day rhythm can be changed with arrow keys', async ({ page }) => {
  await offline(page); await open(page); await skipWelcome(page); await page.click('#gear');
  const h = page.locator('#rhTrk [data-rh="start"]'); const before = await h.getAttribute('aria-valuenow');
  await h.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#rhTrk [data-rh="start"]')).toHaveAttribute('aria-valuenow', String(+before + 15));
  await expect(page.locator('#rhTrk [data-rh="start"]')).toBeFocused();
});

test('no serious accessibility problems on any screen', async ({ page }) => {
  await offline(page); await open(page); await page.waitForTimeout(1000);
  expect(await axeViolations(page), 'welcome').toEqual([]);
  await skipWelcome(page); await page.waitForTimeout(600);
  expect(await axeViolations(page), 'empty trip').toEqual([]);
  await page.click('#gear'); await page.click('#sample'); await page.waitForLoadState('load');
  for (const s of ['where', 'explore', 'stay', 'plan', 'go']) { await page.click(`.step[data-step="${s}"]`); await page.waitForTimeout(700); expect(await axeViolations(page), s).toEqual([]); }
  await page.click('#gear'); expect(await axeViolations(page), 'settings').toEqual([]);
});

test('a crash is reported once to the Safar server, without trip data', async ({ page }) => {
  await offline(page); const sent = [];
  await page.route('**/safar-api.hamid-ebb.workers.dev/err', r => { sent.push(r.request().postData()); r.fulfill({ body: '{}' }); });
  await open(page); await skipWelcome(page);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) setTimeout(() => { throw new Error('test boom'); }, 10 * i); });
  await page.waitForTimeout(600);
  expect(sent.length).toBe(1); const b = JSON.parse(sent[0]);
  expect(b.m).toContain('test boom'); expect(b.t).toBe(1); expect(Object.keys(b).sort()).toEqual(['m', 's', 't', 'ua', 'v']);
});

test('rental car: compare links use trip dates, and a booked car shows in the plan', async ({ page }) => {
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="where"]');
  await page.click('[data-car="want"]');
  const kayak = page.locator('#carBox a', { hasText: 'KAYAK' });
  const d1 = await page.evaluate(() => tripDates()[0]);
  await expect(kayak).toHaveAttribute('href', new RegExp('kayak\\.com/cars/Roma.*/' + d1 + '-10h/'));
  await expect(page.locator('#mode .pill[data-v="drive"]')).toHaveClass(/\bon\b/);
  await page.screenshot({ path: 'test-results/car-card.png' });
  await page.click('[data-car="book"]'); await page.fill('[data-cardr="company"]', 'Hertz'); await page.click('[data-car="save"]');
  await expect(page.locator('#carBox')).toContainText('Hertz · booked');
  await page.click('.step[data-step="plan"]');
  await expect(page.locator('#planOut .carline').first()).toContainText('Pick up Hertz car');
  expect(errors).toEqual([]);
});

test('map switches to the backup style when the main map service is down', async ({ page }) => {
  await offline(page); let backup = 0;
  await page.route('**/tiles.openfreemap.org/**', r => r.abort());
  await page.route('**/tiles.versatiles.org/**', r => { backup++; r.fulfill({ body: '{"version":8,"sources":{},"layers":[{"id":"background","type":"background"}]}', contentType: 'application/json' }); });
  await open(page); await skipWelcome(page);
  await expect.poll(() => page.evaluate(() => typeof mapOK !== 'undefined' && mapOK), { timeout: 15000 }).toBe(true);
  expect(backup).toBeGreaterThan(0);
});

test('feedback form sends the message to the Safar server', async ({ page }) => {
  await offline(page); let body = null;
  await page.route('**/safar-api.hamid-ebb.workers.dev/feedback', r => { body = JSON.parse(r.request().postData()); r.fulfill({ body: '{"ok":true}', contentType: 'application/json' }); });
  await open(page); await skipWelcome(page); await page.click('#gear'); await page.click('#fbOpen');
  await expect(page.locator('#fbSheet')).toHaveClass(/\bon\b/);
  await page.fill('#fbMsg', 'Love the rental car option'); await page.click('#fbSend');
  await expect(page.locator('#fbSheet')).not.toHaveClass(/\bon\b/);
  expect(body.m).toBe('Love the rental car option');
});

test('a trip link made by the Claude/ChatGPT connector opens as a plan, before any hotel is chosen', async ({ page }) => {
  const errors = await offline(page); const hash = require('fs').readFileSync(require('path').join(__dirname, 'fixtures/mcp-hash.txt'), 'utf8').trim();
  await open(page, '#' + hash);
  await expect(page.locator('#welSheet')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.step[data-step="plan"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#planOut')).toContainText('Days in Rome start from the city centre until you choose a hotel', { timeout: 20000 });
  expect(await page.evaluate(() => PL().days.length === tripDates().length && PL().days.length > 0)).toBe(true);
  await page.evaluate(() => { S.cur = cities()[0].id; addPlace({ name: 'Hotel Artemide', lat: 41.9003, lng: 12.4925, type: 'base' }); });
  expect(await page.evaluate(() => bases().map(b => b.name))).toEqual(['Hotel Artemide']);
  expect(await page.evaluate(() => S.places.map(p => p.name))).toContain("St. Peter's Basilica");
  expect(errors).toEqual([]);
});

test('Add to calendar writes the plan into the connected Google calendar', async ({ page }) => {
  await offline(page); const posted = [];
  await page.route('**/api.open-meteo.com/**', r => r.fulfill({ body: '{"timezone":"Europe/Rome"}', contentType: 'application/json' }));
  await page.route('**/www.googleapis.com/calendar/v3/calendars/primary/events', r => { posted.push(JSON.parse(r.request().postData())); r.fulfill({ body: JSON.stringify({ id: 'ev' + posted.length }), contentType: 'application/json' }); });
  await open(page); await demoTrip(page);
  await page.evaluate(() => { S.account = { provider: 'google', email: 't@example.com', name: 'T' }; S.links = [{ prov: 'google', email: 't@example.com', token: 'x', exp: Date.now() + 3e6, mail: true, cal: true, calw: true }]; saveNow(); });
  await page.click('.step[data-step="plan"]'); await page.click('#ics');
  await expect.poll(() => posted.length, { timeout: 15000 }).toBeGreaterThan(3);
  expect(posted[0].start.timeZone).toBe('Europe/Rome'); expect(posted[0].start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
  await expect(page.locator('#toast')).toContainText('added to Google Calendar');
});

test('opening hours from OpenStreetMap set visit times and flag closed days', async ({ page }) => {
  await offline(page);
  await page.route('**/safar-api.hamid-ebb.workers.dev/cache/overpass', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'way', center: { lat: 41.8902, lon: 12.4922 }, tags: { name: 'Colosseo', 'name:en': 'Colosseum', opening_hours: 'Mo-Su 08:30-19:15' } },
    { type: 'node', lat: 41.8986, lon: 12.4769, tags: { name: 'Pantheon', opening_hours: 'Mo-Su 09:00-19:00; ' + ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(Date.now() + 864e5).getDay()] + ' off' } }] }) }));
  await open(page); await demoTrip(page);
  await page.evaluate(() => { S.places.forEach(p => { delete p.ohChk; if (p.name === 'Colosseum') { p.open = ''; p.close = ''; } }); S.planHash = null; save(); });
  await page.click('.step[data-step="plan"]');
  await expect(page.locator('#planOut')).toContainText('Day 1');
  const col = await page.evaluate(() => S.places.find(p => p.name === 'Colosseum'));
  expect(col.oh).toBe('Mo-Su 08:30-19:15'); expect(col.open).toBe('08:30');
  const pan = await page.evaluate(() => [S.places.find(p => p.name === 'Pantheon').oh, closedOn(S.places.find(p => p.name === 'Pantheon'), 0)]);
  expect(pan[1]).toBe(true);
});

test('Save map offline stores the trip area map pieces', async ({ page }) => {
  await offline(page);
  await page.route('**/tiles.openfreemap.org/planet', r => r.fulfill({ contentType: 'application/json', body: '{"tiles":["https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf"],"maxzoom":14}' }));
  await page.route('**/tiles.openfreemap.org/styles/liberty', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sprite: 'https://tiles.openfreemap.org/sprites/x/ofm', glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'l', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } }] }) }));
  await page.route(/tiles\.openfreemap\.org\/(planet\/v1|fonts|sprites)/, r => r.fulfill({ body: 'x' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '/* lib */', contentType: 'text/javascript' }));
  await open(page); await demoTrip(page); await page.click('.step[data-step="plan"]'); await page.click('#offl');
  await expect(page.locator('#offl')).toHaveText('Map saved offline ✓', { timeout: 30000 });
  const n = await page.evaluate(async () => (await (await caches.open('safar-offline-v1')).keys()).filter(r => r.url.endsWith('.pbf') && r.url.includes('/planet/v1/14/')).length);
  expect(n).toBeGreaterThan(4);
});

test('live trip: a companion with the edit link changes the trip and the owner sees it', async ({ browser }) => {
  const rooms = {}; let n = 0;
  const mockLive = async page => { await offline(page); await page.route(/safar-api\.hamid-ebb\.workers\.dev\/live/, async r => {
    const req = r.request(), u = new URL(req.url()), m = u.pathname.match(/^\/live\/?([^/]*)$/), key = req.headers()['x-live-key'], J = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'POST') { const id = 'room' + (++n) + 'abcd'; rooms[id] = { trip: JSON.parse(req.postData()).trip, rev: 1 }; return J({ id, edit: 'editkey123456', owner: 'ownerkey123456', rev: 1 }); }
    const room = rooms[m[1]]; if (!room) return J({ error: 'not found' }, 404);
    if (req.method() === 'GET') { const since = +u.searchParams.get('since') || 0; return J(since >= room.rev ? { rev: room.rev } : room); }
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData()); if (b.base !== room.rev) return J({ error: 'changed', ...room }, 409); room.trip = b.trip; room.rev++; return J({ ok: true, rev: room.rev }); }
    return J({ ok: true }); }); };
  const a = await (await browser.newContext({ serviceWorkers: 'block' })).newPage(); await mockLive(a); await open(a); await demoTrip(a);
  await a.click('.step[data-step="plan"]'); await a.click('#shareB'); await a.click('#liveGo');
  await expect(a.locator('#shareIn')).toContainText('Live trip is on');
  const editLink = await a.evaluate(() => liveUrl(true)); expect(editLink).toMatch(/#live=room1abcd\.editkey123456$/);
  const b = await (await browser.newContext({ serviceWorkers: 'block' })).newPage(); await mockLive(b);
  await open(b, '#live=room1abcd.editkey123456');
  await expect.poll(() => b.evaluate(() => S.live?.role)).toBe('edit');
  await b.evaluate(() => { S.cur = S.cities[0].id; addPlace({ name: 'Mouth of Truth', lat: 41.8881, lng: 12.4814 }); saveNow(); });
  await expect.poll(() => rooms.room1abcd.rev, { timeout: 10000 }).toBe(2);
  await a.evaluate(() => livePoll());
  await expect.poll(() => a.evaluate(() => S.places.some(p => p.name === 'Mouth of Truth'))).toBe(true);
});

test('Farsi: the app switches language and reads right to left', async ({ page }) => {
  const errors = await offline(page); await page.addInitScript(() => { if (!sessionStorage.once) { sessionStorage.once = 1; localStorage.setItem('safar_lang', 'fa'); } });
  await open(page); await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#welIn h2')).toHaveText('به سفر خوش آمدید.');
  await page.click('#welSkip'); await page.locator('#welIn button', { hasText: 'الان نه' }).click(); await page.click('#gear');
  await expect(page.locator('#setSheet h2').first()).toHaveText('تنظیمات');
  await page.selectOption('#langSel', 'en'); await page.waitForLoadState('load');
  await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl');
  expect(errors).toEqual([]);
});

test('rain-aware days: on a rainy forecast day, outdoor sights move to a dry day', async ({ page }) => {
  const errors = await offline(page);
  await page.route('**/api.open-meteo.com/v1/forecast**', r => { const u = new URL(r.request().url()), s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
    if (!s) return r.fulfill({ body: '{"timezone":"Europe/Rome"}', contentType: 'application/json' });
    const time = []; for (let d = new Date(s + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= e; d.setUTCDate(d.getUTCDate() + 1)) time.push(d.toISOString().slice(0, 10));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ timezone: 'Europe/Rome', daily: { time, weather_code: time.map((_, i) => i === 0 ? 63 : 1), temperature_2m_max: time.map(() => 20), temperature_2m_min: time.map(() => 12), precipitation_probability_max: time.map((_, i) => i === 0 ? 90 : 5) } }) }); });
  await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]');
  await expect.poll(() => page.evaluate(() => !!S.plans && (PL().days[0]?.rainSwap != null || (wxOf(0)?.rain === 90 && PL().days.length > 1))), { timeout: 20000 }).toBe(true);
  const r = await page.evaluate(() => { const out = di => PL().days[di].seq.filter(id => wxKind(pById(id)) < 0).length; return { wet: out(0), dry: Math.max(...PL().days.slice(1).map((_, i) => out(i + 1))), swapped: PL().days[0].rainSwap != null }; });
  expect(r.wet).toBeLessThanOrEqual(r.dry);
  if (r.swapped) { await expect(page.locator('#planOut')).toContainText('Rain is likely'); await page.getByText('Keep the original order').click(); expect(await page.evaluate(() => PL().days[0].noRain)).toBe(true); }
  console.log('rain test', JSON.stringify(r));
  expect(errors).toEqual([]);
});

test('book-ahead warnings link timed-ticket sights to their official sites', async ({ page }) => {
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]');
  const notes = page.locator('#planOut .navnote', { hasText: 'Book ahead' });
  for (let i = 0; i < 3 && !(await notes.count()); i++) { await page.locator('.dcard').nth(i + 1).click().catch(() => {}); await page.waitForTimeout(500); }
  await expect(notes.first()).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => PL().days.map((_, i) => bookNote(i)).join(' '))).toContain('https://ticketing.colosseo.it');
  await expect(page.locator('#planOut .sug', { hasText: 'Book ahead' }).first()).toBeVisible();
  expect(await page.evaluate(() => [bookInfo({ name: 'Palazzo Ducale', city: null })?.url ?? null, bookInfo({ name: 'Pantheon' })])).toEqual([null, null]);
  expect(errors).toEqual([]);
});

test('Print day sheets makes one page per day', async ({ page }) => {
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]'); await page.evaluate(() => { window.print = () => { window.__printed = 1; }; });
  await page.click('#printB'); await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  expect(await page.locator('#printBox .psheet').count()).toBe(await page.evaluate(() => tripDates().length));
  await page.emulateMedia({ media: 'print' }); await expect(page.locator('#printBox')).toBeVisible(); await expect(page.locator('#body')).toBeHidden();
  expect(errors).toEqual([]);
});

test('hotel prices: live prices from the Safar server, compare links with trip dates, cheapest first', async ({ page }) => {
  const errors = await offline(page); let asked = null;
  const H = (name, lat, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name, osm_value: 'hotel', district: 'Monti' } });
  await page.route(/photon\.komoot\.io\/api\/\?.*osm_tag=tourism%3Ahotel|photon\.komoot\.io\/api\/\?.*osm_tag=tourism:hotel/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [H('Hotel Artemide', 41.9003, 12.4935), H('Hotel Quirinale', 41.9009, 12.4951)] }) }));
  await page.route('**/safar-api.hamid-ebb.workers.dev/hotel-rates', r => { asked = JSON.parse(r.request().postData()); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, currency: 'CAD', hotels: [
    { name: 'Hotel Artemide', lat: 41.9003, lng: 12.4935, available: true, total: 900, cur: 'CAD', refundable: true },
    { name: 'Hotel Quirinale', lat: 41.9009, lng: 12.4951, available: false },
    { name: 'Hotel Centro Budget', lat: 41.8990, lng: 12.4960, stars: 2, available: true, total: 300, cur: 'CAD', refundable: false }] }) }); });
  await open(page); await demoTrip(page);
  await page.click('.step[data-step="stay"]');
  const art = page.locator('.hcard', { hasText: 'Hotel Artemide' });
  await expect(art.locator('.hrate')).toContainText('per night');
  await expect(art.locator('.hrate')).toContainText('Free cancellation');
  await expect(page.locator('.hcard', { hasText: 'Hotel Quirinale' }).locator('.hrate')).toContainText('No rooms left for your dates');
  const { ci, co, n } = await page.evaluate(() => { const s = stayOf({ city: cur().id }); return { ci: s.ci, co: s.co, n: s.n }; });
  expect(asked.checkin).toBe(ci); expect(asked.checkout).toBe(co);
  await expect(art.locator('.hrate b')).toContainText(String(Math.round(900 / n)));
  await art.locator('[data-cmp]').click();
  await expect(art.locator('.hcmp a', { hasText: 'Expedia' })).toHaveAttribute('href', new RegExp('startDate=' + ci + '&endDate=' + co));
  await expect(art.locator('.hcmp a', { hasText: 'Agoda' })).toHaveAttribute('href', new RegExp('checkIn=' + ci));
  await page.screenshot({ path: 'test-results/hotel-prices.png' });
  await page.click('[data-hf="cheap"]');
  await expect(page.locator('.hcard').first()).toContainText('Hotel Centro Budget');
  expect(errors).toEqual([]);
});

test('hotel prices stay hidden until the server has a price source; compare links still work', async ({ page }) => {
  const errors = await offline(page);
  await page.route(/photon\.komoot\.io\/api\/\?.*osm_tag=tourism/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [12.4935, 41.9003] }, properties: { name: 'Hotel Artemide', osm_value: 'hotel' } }] }) }));
  await page.route('**/safar-api.hamid-ebb.workers.dev/hotel-rates', r => r.fulfill({ contentType: 'application/json', body: '{"enabled":false}' }));
  await open(page); await demoTrip(page);
  await page.click('.step[data-step="stay"]');
  const art = page.locator('.hcard', { hasText: 'Hotel Artemide' });
  await expect(art).toBeVisible(); await expect(art.locator('.hrate')).toHaveCount(0);
  await expect(page.locator('[data-hf="cheap"]')).toHaveCount(0);
  await art.locator('[data-cmp]').click();
  await expect(art.locator('.hcmp a')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('iPhone Live Activity: Go navigation sends the next stop to the lock screen and ends it on exit', async ({ page }) => {
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]'); await expect(page.locator('#planOut')).toContainText('Day 1');
  await page.click('.step[data-step="go"]');
  await page.evaluate(() => { window.__la = []; const rec = n => b => { window.__la.push([n, b]); return Promise.resolve(n === 'start' ? { started: true } : { ok: true }); };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { SafarLiveActivity: { start: rec('start'), update: rec('update'), end: rec('end') } } }; });
  await page.click('#navStart');
  await page.evaluate(() => { const t = navTarget(); navUpdate({ lat: t.p.lat + 0.004, lng: t.p.lng }); });
  await expect.poll(() => page.evaluate(() => window.__la.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__la.length), { timeout: 20000 }).toBeGreaterThan(1);
  const kind = await page.evaluate(() => window.__la[0][0]), body = await page.evaluate(() => window.__la[window.__la.length - 1][1]);
  const next = await page.evaluate(() => navTarget().p.name);
  expect(kind).toBe('start'); expect(body.stop).toBe(next); expect(body.day).toMatch(/^Day 1 · /);
  expect(body.distance).toMatch(/m|km/); expect(body.arrive).toBeGreaterThan(Date.now()); expect(body.stopsLeft).toBeGreaterThan(0);
  await page.click('#navExit');
  await expect.poll(() => page.evaluate(() => window.__la.some(x => x[0] === 'end'))).toBe(true);
  expect(errors).toEqual([]);
});

test('leave-time reminders: the phone gets "Leave in 10 min for …" at the right moment in the city time zone', async ({ page }) => {
  stagingOnly();
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]'); await expect(page.locator('#planOut')).toContainText('Day 1');
  expect(await page.evaluate(() => zonedMs('2026-12-03', 600, 'Europe/Rome'))).toBe(Date.UTC(2026, 11, 3, 9, 0));
  await page.evaluate(() => { window.__sched = []; window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
    requestPermissions: async () => ({ display: 'granted' }), cancel: async () => ({}), schedule: async o => { window.__sched.push(...o.notifications); return {}; } } } };
    S.cities.forEach(c => c.tz = 'Europe/Rome'); const d = new Date(Date.now() + 3 * 864e5); S.settings.startDate = d.toISOString().slice(0, 10); save(); });
  await page.click('.step[data-step="plan"]'); await expect(page.locator('#planOut')).toContainText('Day 1');
  await page.click('#gear'); await page.click('[data-rem="10"]');
  await expect.poll(() => page.evaluate(() => window.__sched.length)).toBeGreaterThan(2);
  const first = await page.evaluate(() => { const n = window.__sched[0], ctx = buildCtx(), days = buildDays(), leg = daySim(ctx, days, 0).sim.ev.find(e => e.type === 'leg' && e.min >= 3 && S.places[e.to]?.type !== 'base');
    return { title: n.title, at: +new Date(n.schedule.at), want: zonedMs(days[0].date, Math.round(leg.start - 10), 'Europe/Rome'), name: S.places[leg.to].name }; });
  expect(first.title).toBe('Leave in 10 min for ' + first.name); expect(first.at).toBe(first.want);
  expect(await page.locator('#remNote').textContent()).toContain('even when Safar is closed');
  expect(errors).toEqual([]);
});

test('Safar Pro: free until payments are switched on; then Pro features open the paywall and buying goes to Stripe for this account', async ({ page }) => {
  stagingOnly();
  const errors = await offline(page); await open(page); await demoTrip(page);
  await page.click('.step[data-step="plan"]'); await expect(page.locator('#planOut')).toContainText('Day 1');
  expect(await page.evaluate(() => isPro())).toBe(true);   // payments off → everything free
  await page.evaluate(() => { PAY.year = 'https://buy.stripe.com/test_year'; PAY.pass = 'https://buy.stripe.com/test_pass'; localStorage.setItem(SESS_KEY, encodeURIComponent('google:42') + '.9999999999.sig'); S.account = { provider: 'google', email: 'a@b.com', name: 'A' }; });
  await page.route('**/safar-api.hamid-ebb.workers.dev/me/pro', r => r.fulfill({ contentType: 'application/json', body: '{"pro":false}' }));
  await page.click('#offl');
  await expect(page.locator('#proSheet')).toHaveClass(/\bon\b/);
  await expect(page.locator('#proIn')).toContainText('Offline maps is part of Safar Pro.');
  await expect(page.locator('#proIn [data-buy="year"]')).toContainText('US$29.99');
  let went = null; await page.route('https://buy.stripe.com/**', r => { went = r.request().url(); r.fulfill({ body: 'stripe' }); });
  await page.click('#proIn [data-buy="pass"]');
  await expect.poll(() => went).not.toBeNull();
  const u = new URL(went); expect(u.pathname).toBe('/test_pass');
  expect(Buffer.from(u.searchParams.get('client_reference_id'), 'base64url').toString()).toBe('google:42');
  expect(u.searchParams.get('prefilled_email')).toBe('a@b.com');
  expect(errors).toEqual([]);
});

test('Safar Pro: a paid account unlocks the features and Settings shows the plan', async ({ page }) => {
  stagingOnly();
  const errors = await offline(page);
  await page.route('**/safar-api.hamid-ebb.workers.dev/me/pro', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ pro: true, plan: 'year', until: Date.now() + 300 * 864e5 }) }));
  await open(page); await demoTrip(page);
  await page.evaluate(async () => { PAY.year = 'https://buy.stripe.com/test_year'; localStorage.setItem(SESS_KEY, encodeURIComponent('google:42') + '.9999999999.sig'); await refreshPro(); });
  expect(await page.evaluate(() => isPro())).toBe(true);
  await page.click('#gear'); await expect(page.locator('#proBox')).toContainText('Safar Pro'); await expect(page.locator('#proBox')).toContainText('Renews');
  expect(errors).toEqual([]);
});

test('Transit: on a metro or bus leg, Go shows live departures near you with Transit credit; nothing when the server has no key', async ({ page }) => {
  stagingOnly();
  const errors = await offline(page);
  let key = true;
  await page.route('**/safar-api.hamid-ebb.workers.dev/transit/near**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(key ? { enabled: true, routes: [{ name: 'M1', color: '0055aa', text: 'ffffff', headsign: 'Duomo', stop: 'Cairoli', dist: 140, times: [{ t: Date.now() / 1000 + 240, rt: true }] }] } : { enabled: false }) }));
  await open(page);
  const first = await page.evaluate(async () => { transitCard({ lm: 'metro' }, { lat: 45.468, lng: 9.18 }); await new Promise(r => setTimeout(r, 600)); return transitCard({ lm: 'metro' }, { lat: 45.468, lng: 9.18 }); });
  expect(first).toContain('Departures near you'); expect(first).toContain('M1'); expect(first).toContain('4 min'); expect(first).toContain('alt="Powered by Transit"');
  expect(await page.evaluate(() => transitCard({ lm: 'walk' }, { lat: 45.468, lng: 9.18 }))).toBe('');
  key = false;
  const off = await page.evaluate(async () => { TR.data = null; TR.key = ''; transitCard({ lm: 'bus' }, { lat: 40, lng: 10 }); await new Promise(r => setTimeout(r, 600)); return transitCard({ lm: 'bus' }, { lat: 40, lng: 10 }); });
  expect(off).toBe('');
  expect(errors).toEqual([]);
});
