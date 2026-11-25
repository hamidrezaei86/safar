import { mcp } from './mcp.js';
// Deployed by Cloudflare Workers Builds from github.com/hamidrezaei86/safar (server/) on every push to main.
// Safar server (Cloudflare Worker, free plan)
// - /auth: turns a Google or Microsoft sign-in into a Safar session (only sign-ins made through Safar's own app are accepted)
// - /me/trip: keeps each user's trip so it syncs between devices, plus one earlier copy as a safety backup
// - /me (DELETE): deletes the account and all its data
// - /cache/overpass: remembers public map lookups (cafés, restaurants) so repeat requests are instant
// - /err: receives short crash notes from the app (message and code location only) so problems get fixed
// - /mcp: the Safar connector for Claude and ChatGPT (see mcp.js)
// - /ev, /feedback: anonymous usage counts and in-app feedback; /admin shows them (admin key)
// - /transit/near: live public transport departures near a point (Transit API, when its key is set; kept under the free 1,500 calls a month)
// - /hotel-rates: live room prices for the trip dates (LiteAPI, when its key is set)
// - /admin/export, /admin/import: weekly off-site backup and restore (admin keys only)
// - /pay/webhook, /me/pro: Safar Pro purchases through Stripe payment links (Stripe-signed) and the signed-in user's Pro status
// - every busy route has an hourly cap per address (see CAPS) so one bad actor can't use up the free plan
// - /status: public health page: server version, approximate use of the free plan today, and today's app errors
const ORIGINS = ['https://safar.amovasolutions.com', 'capacitor://localhost', 'http://localhost', 'http://localhost:8080'];
const GOOGLE_CLIENTS = ['233536196878-843has094vmppelok2i589uvv33ub158.apps.googleusercontent.com', '233536196878-vlslvl02cq3n8ir3t198h6nm5bv3nmfv.apps.googleusercontent.com'];
const MS_CLIENT = '34a6eda6-18b0-4109-8f99-d64b5dc01647';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(data))); }
async function sha(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function cors(req) { const o = req.headers.get('Origin') || ''; return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Key,X-Live-Key', 'Access-Control-Max-Age': '86400', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }; }
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });
let KEY;
async function skey(env) { if (KEY) return KEY; KEY = env.SESSION_KEY || await env.SAFAR.get('cfg:session_key'); if (!KEY) { KEY = b64u(crypto.getRandomValues(new Uint8Array(32))); await env.SAFAR.put('cfg:session_key', KEY); } return KEY; }
async function session(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer /, ''); const [uid, exp, sig] = t.split('.');
  if (!uid || !exp || !sig || +exp < Date.now() / 1000) return null;
  return (await hmac(await skey(env), uid + '.' + exp)) === sig ? decodeURIComponent(uid) : null;
}
let MSKEYS, MSKEYS_AT = 0;
async function msIdToken(idt) {
  const [h, p, s] = String(idt || '').split('.'); if (!h || !p || !s) return null;
  const head = JSON.parse(new TextDecoder().decode(unb64u(h))), c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (c.aud !== MS_CLIENT || !(c.exp > Date.now() / 1000) || !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/.test(c.iss || '')) return null;
  if (!MSKEYS || Date.now() - MSKEYS_AT > 3600000) { MSKEYS = (await (await fetch('https://login.microsoftonline.com/common/discovery/v2.0/keys')).json()).keys || []; MSKEYS_AT = Date.now(); }
  const jwk = MSKEYS.find(k => k.kid === head.kid); if (!jwk || head.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(h + '.' + p)))) return null;
  const email = c.email || c.preferred_username || ''; return (c.oid || c.sub) ? { id: 'microsoft:' + (c.oid || c.sub), email, name: c.name || email, picture: '' } : null;
}
async function verify(provider, token, idt) {
  if (provider === 'google') {
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token)); if (!ti.ok) return null; const t = await ti.json();
    if (!GOOGLE_CLIENTS.includes(t.aud) && !GOOGLE_CLIENTS.includes(t.azp)) return null;                 // the token must have been issued to Safar
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) return null; const u = await r.json();
    return u.sub && { id: 'google:' + u.sub, email: u.email, name: u.name || u.email, picture: u.picture || '' };
  }
  if (provider === 'microsoft') return msIdToken(idt);                                                   // signed by Microsoft for Safar's app id
  return null;
}

// ---- usage and error log (approximate, cheap on the free plan's daily write limit) ----
const LIMITS = { requests: 100000, kvReads: 100000, kvWrites: 1000 };
const day = () => new Date().toISOString().slice(0, 10);
let USE = { requests: 0, kvReads: 0, kvWrites: 0 }, USE_AT = Date.now(), ERRS = {}, ERR_AT = 0, EV = {}, FB_N = {};
const ADMIN_HASH = 'PAx4Lz0E8hWLpB6ZVe3VP-pfkAXWJ7f_mGfobHdYvaY';   // SHA-256 of the admin key (the key itself is not stored here)
const clean = t => String(t || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/https?:\/\/[^\s)'"]+/g, u => u.replace(/[?#].*?(?=(:\d+:\d+)?$)/, '')).replace(/\b(eyJ|ya29\.|sk-|AIza)[\w.-]+/g, '<token>').replace(/\d{6,}/g, '<n>');
function wrapKV(kv) { return { get: (...a) => { USE.kvReads++; return kv.get(...a); }, put: (...a) => { USE.kvWrites++; return kv.put(...a); }, delete: (...a) => { USE.kvWrites++; return kv.delete(...a); } }; }
async function flushUse(env, force) {
  if (!force && USE.requests < 300 && !USE.feedback && Date.now() - USE_AT < 600000) return; const add = USE, ev = EV; USE = { requests: 0, kvReads: 0, kvWrites: 0 }; EV = {}; USE_AT = Date.now();
  const k = 'use:' + day(), cur = JSON.parse(await env.SAFAR.get(k) || '{}'); add.kvReads++; add.kvWrites++;
  for (const x in add) cur[x] = (cur[x] || 0) + add[x];
  cur.ev = cur.ev || {}; for (const e in ev) if (cur.ev[e] != null || Object.keys(cur.ev).length < 120) cur.ev[e] = (cur.ev[e] || 0) + ev[e];
  await env.SAFAR.put(k, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 400 });
}
async function flushErrs(env, force) {
  const keys = Object.keys(ERRS); if (!keys.length || (!force && (Date.now() - ERR_AT < 60000 || (Date.now() - ERR_AT < 600000 && !keys.some(h => ERRS[h].fresh))))) return;   // at most one write a minute per server copy
  const add = ERRS; ERRS = {}; ERR_AT = Date.now(); const k = 'err:' + day(), cur = JSON.parse(await env.SAFAR.get(k) || '{}'); USE.kvReads++;
  for (const h in add) { const a = add[h], c = cur[h]; if (c) { c.n += a.n; c.last = a.last; } else if (Object.keys(cur).length < 60) { delete a.fresh; cur[h] = a; } }
  USE.kvWrites++; await env.SAFAR.put(k, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 30 });
}
// The weekly backup job proves who it is with GitHub's signed token (no shared key): only .github/workflows/backup.yml on main of the Safar repository passes.
let GHKEYS, GHKEYS_AT = 0;
async function githubBackupJob(req) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer /, ''), [h, p, sg] = t.split('.'); if (!h || !p || !sg) return false;
  try { const head = JSON.parse(new TextDecoder().decode(unb64u(h))), c = JSON.parse(new TextDecoder().decode(unb64u(p)));
    if (c.iss !== 'https://token.actions.githubusercontent.com' || c.aud !== 'safar-backup' || !(c.exp > Date.now() / 1000) || c.repository !== 'hamidrezaei86/safar' || !String(c.job_workflow_ref || c.workflow_ref || '').startsWith('hamidrezaei86/safar/.github/workflows/backup.yml@refs/heads/main')) return false;
    if (!GHKEYS || Date.now() - GHKEYS_AT > 3600000) { GHKEYS = (await (await fetch('https://token.actions.githubusercontent.com/.well-known/jwks')).json()).keys || []; GHKEYS_AT = Date.now(); }
    const jwk = GHKEYS.find(k => k.kid === head.kid); if (!jwk || head.alg !== 'RS256') return false;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(sg), enc.encode(h + '.' + p));
  } catch (e) { return false; }
}
// ---- abuse limits: per-address caps per hour, kept in memory (free, no storage writes). Each server copy counts on its own, so the caps are approximate. ----
const CAPS = { transit: 60, 'hotel-rates': 60, 'live-new': 20, 'live-put': 600, mcp: 120, overpass: 300, auth: 30, 'trip-put': 600, export: 200 };
let HITS = new Map(), HITS_HOUR = 0; const TRM = { m: 0, n: 0 };
function overCap(req, kind) {
  const hr = Math.floor(Date.now() / 36e5); if (hr !== HITS_HOUR || HITS.size > 20000) { HITS = new Map(); HITS_HOUR = hr; }
  const k = kind + '|' + (req.headers.get('CF-Connecting-IP') || '?'), n = (HITS.get(k) || 0) + 1; HITS.set(k, n);
  return n > CAPS[kind];
}
const tooMany = (req, kind) => { EV['limit:' + kind] = (EV['limit:' + kind] || 0) + 1; return new Response(JSON.stringify({ error: 'too many requests, try again later' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(3600 - Math.floor(Date.now() / 1000) % 3600), ...cors(req) } }); };
const okTrip = t => t && typeof t === 'object' && !Array.isArray(t) && t.v === 2 && Array.isArray(t.cities) && Array.isArray(t.places) && !t.links && !t.ai && !t.account;
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    const raw = env.SAFAR; env = { ...env, SAFAR: wrapKV(raw) }; USE.requests++;
    const later = f => ctx?.waitUntil ? ctx.waitUntil(f.catch(() => {})) : f.catch(() => {});
    later(flushUse({ SAFAR: raw }));
    try {
      if (p === '/' || p === '/health') return json(req, { ok: true, service: 'safar', v: 7 });
      if (p === '/mcp') { if (req.method === 'POST' && overCap(req, 'mcp')) return tooMany(req, 'mcp'); const ek = 'mcp:' + req.method.toLowerCase(); EV[ek] = (EV[ek] || 0) + 1; return mcp(req); }
      if (p === '/ev' && req.method === 'POST') {
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const b = await req.text(); let e = ''; try { e = String(JSON.parse(b).e || ''); } catch (x) {}
        if (b.length < 300 && /^[a-z]+(:[a-z0-9.-]{1,40})?$/.test(e)) EV[e] = (EV[e] || 0) + 1; return json(req, { ok: true });
      }
      if (p === '/feedback' && req.method === 'POST') {
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const ip = req.headers.get('CF-Connecting-IP') || '?', fk = ip + '|' + Math.floor(Date.now() / 36e5);
        if ((FB_N[fk] = (FB_N[fk] || 0) + 1) > 5) return json(req, { error: 'too many messages, try again later' }, 429);
        if (Object.keys(FB_N).length > 5000) FB_N = {};
        const b = await req.text(); if (b.length > 5000) return json(req, { error: 'too long' }, 413);
        const j = JSON.parse(b), m = String(j.m || '').trim().slice(0, 2000); if (m.length < 3) return json(req, { error: 'empty' }, 400);
        const rec = { m, mail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(j.mail || '') ? String(j.mail).slice(0, 120) : '', v: String(j.v || '').slice(0, 40), step: String(j.step || '').slice(0, 12), cities: +j.cities || 0, ua: String(req.headers.get('User-Agent') || '').slice(0, 160), at: Date.now() };
        await env.SAFAR.put('fb:' + (9e15 - Date.now()) + ':' + Math.random().toString(36).slice(2, 7), JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
        USE.feedback = (USE.feedback || 0) + 1; later(flushUse({ SAFAR: raw })); return json(req, { ok: true });
      }
      if (p === '/admin') {
        const k = req.headers.get('X-Admin-Key') || ''; if (!k || await sha(k) !== ADMIN_HASH) return json(req, { error: 'not allowed' }, 403);
        const n = Math.max(1, Math.min(60, +url.searchParams.get('days') || 30)), days = [...Array(n)].map((_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
        await flushUse({ SAFAR: raw }, true);
        const use = await Promise.all(days.map(async d => ({ day: d, ...JSON.parse(await raw.get('use:' + d) || '{}') })));
        const list = await raw.list({ prefix: 'fb:', limit: 100 }), fb = (await Promise.all(list.keys.map(x => raw.get(x.name)))).filter(Boolean).map(t => JSON.parse(t));
        return json(req, { days: use, feedback: fb });
      }
      if (p === '/admin/export') { if (overCap(req, 'export')) return tooMany(req, 'export');      // weekly off-site backup: users' trips, accounts and live trips, a page at a time (read-only)
        const k = req.headers.get('X-Admin-Key') || ''; if (!(k && await sha(k) === ADMIN_HASH) && !(await githubBackupJob(req))) return json(req, { error: 'not allowed' }, 403);
        const prefix = url.searchParams.get('prefix') || ''; if (!['trip:', 'trip-prev:', 'user:', 'live:', 'pro:', 'cus:'].includes(prefix)) return json(req, { error: 'bad prefix' }, 400);
        const list = await raw.list({ prefix, limit: 200, cursor: url.searchParams.get('cursor') || undefined });
        const items = await Promise.all(list.keys.map(async x => ({ k: x.name, v: await raw.get(x.name), exp: x.expiration || null })));
        return json(req, { items, cursor: list.list_complete ? null : list.cursor });
      }
      if (p === '/admin/import' && req.method === 'POST') {   // restore from a backup (full admin key only)
        const k = req.headers.get('X-Admin-Key') || ''; if (!k || await sha(k) !== ADMIN_HASH) return json(req, { error: 'not allowed' }, 403);
        const j = JSON.parse(await req.text()), items = (j.items || []).filter(x => /^(trip|trip-prev|user|live|pro|cus):/.test(x.k) && typeof x.v === 'string').slice(0, 200);
        const onlyMissing = j.onlyMissing !== false; let n = 0;
        for (const x of items) { if (onlyMissing && await raw.get(x.k) != null) continue; await raw.put(x.k, x.v, x.exp && x.exp > Date.now() / 1000 + 60 ? { expiration: x.exp } : undefined); n++; }
        return json(req, { restored: n });
      }
      if (p === '/err' && req.method === 'POST') {
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const b = await req.text(); if (b.length > 4000) return json(req, { error: 'too long' }, 413);
        const j = JSON.parse(b), m = clean(j.m).slice(0, 300); if (!m) return json(req, { ok: true });
        const s = clean(j.s).split('\n').slice(0, 5).join('\n').slice(0, 700), h = (await sha(m + '|' + s.split('\n')[1])).slice(0, 12), now = Date.now();
        const e = ERRS[h] || (ERRS[h] = { m, s, v: String(j.v || '').slice(0, 40), test: !!j.t, ua: clean(j.ua).slice(0, 160), n: 0, first: now, fresh: true });
        e.n++; e.last = now; later(flushErrs({ SAFAR: raw })); return json(req, { ok: true });
      }
      if (p === '/status') {
        await Promise.all([flushUse({ SAFAR: raw }, true), flushErrs({ SAFAR: raw }, true)]);
        const d = url.searchParams.get('day') || day(); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json(req, { error: 'bad day' }, 400);
        const use = JSON.parse(await raw.get('use:' + d) || '{}'), errs = Object.values(JSON.parse(await raw.get('err:' + d) || '{}')).sort((a, b) => b.n - a.n);
        const pct = Object.fromEntries(Object.keys(LIMITS).map(k => [k, Math.round((use[k] || 0) / LIMITS[k] * 100)]));
        return json(req, { ok: true, v: 7, day: d, usage: use, freePlanLimits: LIMITS, usedPercent: pct, note: 'usage counts are approximate; Cloudflare\'s dashboard is the exact figure',
          errors: { distinct: errs.length, total: errs.reduce((n, e) => n + e.n, 0), real: errs.filter(e => !e.test).length, list: errs.slice(0, 20).map(({ m, s, v, n, test, first, last }) => ({ m, at: s.split('\n').find(l => /:\d+:\d+/.test(l)) || '', v, n, test, first, last })) } });
      }
      if (p === '/transit/near' && req.method === 'GET') {   // routes and live departures near a point (Transit API); off until the TRANSIT_KEY secret is set
        if (overCap(req, 'transit')) return tooMany(req, 'transit');
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const TKEY = env.TRANSIT_KEY || env.TRANSIENT_KEY;   // the dashboard saved it as TRANSIENT_KEY
        if (!TKEY) return json(req, { enabled: false });
        const lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon');
        if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || (!lat && !lon)) return json(req, { error: 'bad request' }, 400);
        const ck = new Request(`https://cache.safar/tr/${lat.toFixed(3)},${lon.toFixed(3)}`);   // one answer per ~100 m square for 90 s
        const hit = await caches.default.match(ck); if (hit) { const r = new Response(hit.body, hit); Object.entries(cors(req)).forEach(([k, v]) => r.headers.set(k, v)); return r; }
        const mk = 'transit:' + new Date().toISOString().slice(0, 7), used = +(await env.SAFAR.get(mk) || 0);
        const minute = Math.floor(Date.now() / 60000); if (TRM.m !== minute) { TRM.m = minute; TRM.n = 0; }
        if (used >= (+env.TRANSIT_MONTHLY || 1400) || TRM.n >= 4) { EV['transit:budget'] = (EV['transit:budget'] || 0) + 1; return json(req, { enabled: true, routes: [], busy: true }); }
        TRM.n++; await env.SAFAR.put(mk, String(used + 1), { expirationTtl: 60 * 60 * 24 * 40 });
        const r = await fetch(`https://external.transitapp.com/v3/public/nearby_routes?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&max_distance=600`, { headers: { apiKey: TKEY, 'Accept-Language': 'en' } });
        EV['transit:call'] = (EV['transit:call'] || 0) + 1;
        if (!r.ok) return json(req, { enabled: true, routes: [], error: 'transit ' + r.status }, 502);
        const j = await r.json(), out = [];
        for (const rt of j.routes || []) for (const it of rt.itineraries || []) {
          const times = (it.schedule_items || []).filter(x => !x.is_cancelled).map(x => ({ t: +x.departure_time, rt: !!x.is_real_time })).filter(x => x.t > Date.now() / 1000 - 60).slice(0, 3);
          if (!times.length) continue;
          out.push({ name: rt.route_short_name || rt.route_long_name || '', mode: rt.mode_name || '', color: /^[0-9a-f]{6}$/i.test(rt.route_color || '') ? rt.route_color : '', text: /^[0-9a-f]{6}$/i.test(rt.route_text_color || '') ? rt.route_text_color : '',
            headsign: it.merged_headsign || it.headsign || it.direction_headsign || '', stop: it.closest_stop?.stop_name || '', dist: it.closest_stop?.stop_lat != null ? Math.round(Math.hypot((it.closest_stop.stop_lat - lat) * 111320, (it.closest_stop.stop_lon - lon) * 111320 * Math.cos(lat * Math.PI / 180))) : 0, times });
        }
        out.sort((a, b) => a.times[0].t - b.times[0].t);
        const res = json(req, { enabled: true, routes: out.slice(0, 12), attribution: 'Powered by Transit' }); res.headers.set('Cache-Control', 'public, max-age=90'); later(caches.default.put(ck, res.clone())); return res;
      }
      if (p === '/hotel-rates' && req.method === 'POST') {    // live hotel prices for a city (LiteAPI); off until the LITEAPI_KEY secret is set
        if (overCap(req, 'hotel-rates')) return tooMany(req, 'hotel-rates');
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        if (!env.LITEAPI_KEY) return json(req, { enabled: false });
        const b = await req.text(); if (b.length > 20000) return json(req, { error: 'too long' }, 413);
        const j = JSON.parse(b), ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
        if (!ok(j.checkin) || !ok(j.checkout) || !(+j.lat) || !(+j.lng)) return json(req, { error: 'bad request' }, 400);
        const adults = Math.max(1, Math.min(8, +j.adults || 2)), cur = /^[A-Z]{3}$/.test(j.currency || '') ? j.currency : 'USD';
        const ck = new Request('https://cache.safar/hr/' + (await sha([(+j.lat).toFixed(3), (+j.lng).toFixed(3), j.checkin, j.checkout, adults, cur].join('|'))));
        const hit = await caches.default.match(ck); if (hit) { const r = new Response(hit.body, hit); Object.entries(cors(req)).forEach(([k, v]) => r.headers.set(k, v)); return r; }
        const L = 'https://api.liteapi.travel/v3.0', H = { 'X-API-Key': env.LITEAPI_KEY, accept: 'application/json', 'content-type': 'application/json' };
        const near = await (await fetch(`${L}/data/hotels?latitude=${(+j.lat).toFixed(5)}&longitude=${(+j.lng).toFixed(5)}&radius=2500&limit=60`, { headers: H })).json();
        const hotels = (near.data || []).filter(h => h.id && h.name);
        let out = { enabled: true, currency: cur, hotels: [] };
        if (hotels.length) {
          const r = await (await fetch(`${L}/hotels/rates`, { method: 'POST', headers: H, body: JSON.stringify({ hotelIds: hotels.map(h => h.id), checkin: j.checkin, checkout: j.checkout, currency: cur, guestNationality: /^[A-Z]{2}$/.test(j.country || '') ? j.country : 'CA', occupancies: [{ adults }], timeout: 8 }) })).json();
          const price = new Map();
          for (const x of r.data || []) { let best = null;
            for (const rt of x.roomTypes || []) { const a = +(rt.offerRetailRate?.amount ?? rt.rates?.[0]?.retailRate?.total?.[0]?.amount); if (!(a > 0)) continue;
              if (!best || a < best.total) best = { total: a, cur: rt.offerRetailRate?.currency || rt.rates?.[0]?.retailRate?.total?.[0]?.currency || cur, refundable: (rt.rates || []).some(z => z.cancellationPolicies?.refundableTag === 'RFN'), room: rt.rates?.[0]?.name || '' }; }
            if (best) price.set(x.hotelId, best); }
          out.hotels = hotels.map(h => ({ name: h.name, lat: +h.latitude, lng: +h.longitude, stars: +h.stars || 0, ...(price.has(h.id) ? { available: true, ...price.get(h.id) } : { available: false }) }));
        }
        const res = json(req, out); res.headers.set('Cache-Control', 'public, max-age=1800'); later(caches.default.put(ck, res.clone())); return res;
      }
      if (p === '/live' && req.method === 'POST') {          // start a live shared trip
        if (overCap(req, 'live-new')) return tooMany(req, 'live-new');
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const t = await req.text(); if (t.length > 1500000) return json(req, { error: 'trip too large' }, 413);
        const j = JSON.parse(t); if (!okTrip(j.trip)) return json(req, { error: 'not a Safar trip' }, 400);
        const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n))), id = rnd(9), edit = rnd(12), owner = rnd(12);
        await env.SAFAR.put('live:' + id, JSON.stringify({ trip: j.trip, rev: 1, at: Date.now(), ek: await sha(edit), ok: await sha(owner) }), { expirationTtl: 60 * 60 * 24 * 180 });
        return json(req, { id, edit, owner, rev: 1 });
      }
      const lm = p.match(/^\/live\/([A-Za-z0-9_-]{8,40})$/);
      if (lm) {
        const k = 'live:' + lm[1], cur = JSON.parse(await env.SAFAR.get(k, req.method === 'GET' ? { cacheTtl: 30 } : undefined) || 'null'); if (!cur) return json(req, { error: 'not found' }, 404);
        if (req.method === 'GET') { const since = +url.searchParams.get('since') || 0; return json(req, since >= cur.rev ? { rev: cur.rev } : { rev: cur.rev, trip: cur.trip }); }
        const key = await sha(req.headers.get('X-Live-Key') || '-');
        if (req.method === 'DELETE') { if (key !== cur.ok) return json(req, { error: 'not allowed' }, 403); await env.SAFAR.delete(k); return json(req, { ok: true }); }
        if (req.method === 'PUT') {
          if (overCap(req, 'live-put')) return tooMany(req, 'live-put');
          if (key !== cur.ek && key !== cur.ok) return json(req, { error: 'not allowed' }, 403);
          const t = await req.text(); if (t.length > 1500000) return json(req, { error: 'trip too large' }, 413);
          const j = JSON.parse(t); if (!okTrip(j.trip)) return json(req, { error: 'not a Safar trip' }, 400);
          if (+j.base !== cur.rev) return json(req, { error: 'changed', rev: cur.rev, trip: cur.trip }, 409);
          cur.trip = j.trip; cur.rev++; cur.at = Date.now(); await env.SAFAR.put(k, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 180 }); return json(req, { ok: true, rev: cur.rev });
        }
      }
      if (p === '/auth' && req.method === 'POST') {
        if (overCap(req, 'auth')) return tooMany(req, 'auth');
        const { provider, token, id_token } = await req.json(); const u = await verify(provider, token, id_token); if (!u) return json(req, { error: 'sign-in could not be verified' }, 401);
        const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90, uid = encodeURIComponent(u.id), sess = uid + '.' + exp + '.' + await hmac(await skey(env), uid + '.' + exp);
        const prev = JSON.parse(await env.SAFAR.get('user:' + u.id) || 'null'); if (!prev || Date.now() - (prev.last || 0) > 86400000) await env.SAFAR.put('user:' + u.id, JSON.stringify({ ...u, since: prev?.since || Date.now(), last: Date.now() }));
        return json(req, { session: sess, user: u });
      }
      if (p === '/me/trip' || p === '/me/trip/previous') {
        const uid = await session(req, env); if (!uid) return json(req, { error: 'not signed in' }, 401);
        if (req.method === 'GET') { const t = await env.SAFAR.get((p.endsWith('previous') ? 'trip-prev:' : 'trip:') + uid); return json(req, t ? JSON.parse(t) : { trip: null, updated: 0 }); }
        if (req.method === 'PUT' && p === '/me/trip') {
          if (overCap(req, 'trip-put')) return tooMany(req, 'trip-put');
          const b = await req.text(); if (b.length > 2000000) return json(req, { error: 'trip too large' }, 413);
          const j = JSON.parse(b); if (!okTrip(j.trip)) return json(req, { error: 'not a Safar trip' }, 400);
          const old = await env.SAFAR.get('trip:' + uid);
          if (old) { const o = JSON.parse(old), was = o.trip?.cities?.length || 0, now = j.trip.cities.length; if ((was && !now) || Date.now() - (o.saved || 0) > 1800000) await env.SAFAR.put('trip-prev:' + uid, old); if (was && !now && !j.clear) return json(req, { ok: true, kept: true }); }
          await env.SAFAR.put('trip:' + uid, JSON.stringify({ trip: j.trip, updated: +j.updated || Date.now(), saved: Date.now() })); return json(req, { ok: true });
        }
      }
      if (p === '/pay/webhook' && req.method === 'POST') {   // Stripe tells Safar a payment went through; only Stripe-signed messages count
        if (!env.STRIPE_WHSEC) return json(req, { error: 'payments not set up' }, 503);
        const body = await req.text(), sig = Object.fromEntries((req.headers.get('Stripe-Signature') || '').split(',').map(x => x.split('=')).filter(x => x.length === 2)), all = (req.headers.get('Stripe-Signature') || '').split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
        const k = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WHSEC), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(sig.t + '.' + body)))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (!sig.t || Math.abs(Date.now() / 1000 - +sig.t) > 600 || !all.includes(want)) return json(req, { error: 'bad signature' }, 400);
        const ev = JSON.parse(body), o = ev.data?.object || {}, DAY = 864e5;
        const load = async uid => JSON.parse(await env.SAFAR.get('pro:' + uid) || 'null') || {}, keep = (uid, r) => env.SAFAR.put('pro:' + uid, JSON.stringify(r));
        if (ev.type === 'checkout.session.completed' && o.client_reference_id) {
          let uid = ''; try { uid = new TextDecoder().decode(unb64u(o.client_reference_id)); } catch (x) {} if (!/^(google|microsoft|apple):[\w.@-]{1,120}$/.test(uid)) return json(req, { ok: true, skipped: 'unknown account' });
          if (o.payment_status !== 'paid' && o.payment_status !== 'no_payment_required') return json(req, { ok: true, skipped: 'unpaid' });
          const r = await load(uid), base = Math.max(Date.now(), r.until || 0);
          if (o.mode === 'subscription') Object.assign(r, { plan: 'year', until: Math.max(r.until || 0, Date.now() + 367 * DAY), sub: o.subscription || r.sub, canceled: false });
          else Object.assign(r, { plan: r.plan === 'year' && r.until > Date.now() ? 'year' : 'pass', until: base + 30 * DAY });
          if (o.customer) { r.customer = o.customer; await env.SAFAR.put('cus:' + o.customer, uid); }
          r.at = Date.now(); await keep(uid, r); return json(req, { ok: true });
        }
        if ((ev.type === 'invoice.paid' || ev.type === 'customer.subscription.deleted') && o.customer) {
          const uid = await env.SAFAR.get('cus:' + o.customer); if (!uid) return json(req, { ok: true, skipped: 'unknown customer' });
          const r = await load(uid);
          if (ev.type === 'invoice.paid') { const end = Math.max(0, ...(o.lines?.data || []).map(l => +l.period?.end || 0)); if (end) Object.assign(r, { plan: 'year', until: Math.max(r.until || 0, end * 1000 + 2 * DAY), canceled: false }); }
          else r.canceled = true;   // stays Pro until the paid year ends
          r.at = Date.now(); await keep(uid, r); return json(req, { ok: true });
        }
        return json(req, { ok: true, ignored: ev.type });
      }
      if (p === '/me/pro') {
        const uid = await session(req, env); if (!uid) return json(req, { error: 'not signed in' }, 401);
        const r = JSON.parse(await env.SAFAR.get('pro:' + uid) || 'null'); return json(req, r ? { pro: r.until > Date.now(), plan: r.plan, until: r.until, canceled: !!r.canceled } : { pro: false });
      }
      if (p === '/me' && req.method === 'DELETE') {
        const uid = await session(req, env); if (!uid) return json(req, { error: 'not signed in' }, 401);
        await Promise.all(['trip:', 'trip-prev:', 'user:'].map(k => env.SAFAR.delete(k + uid)));   // Pro purchase records (pro:, cus:) are kept for refunds and tax records return json(req, { ok: true, deleted: true });
      }
      if (p === '/cache/overpass' && req.method === 'POST') {
        if (overCap(req, 'overpass')) return tooMany(req, 'overpass');
        if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, { error: 'not allowed' }, 403);
        const q = await req.text(); if (q.length > 20000 || !/^\s*\[out:json\]/.test(q)) return json(req, { error: 'bad query' }, 400);
        const key = 'op:' + await sha(q), hit = await env.SAFAR.get(key);
        if (hit) return new Response(hit, { headers: { 'Content-Type': 'application/json', 'X-Cache': 'hit', ...cors(req) } });
        const body = 'data=' + encodeURIComponent(q);
        const r = await Promise.any(OVERPASS.map(u => fetch(u, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Safar/1.0 (+https://safar.amovasolutions.com/)', Accept: 'application/json' } }).then(async r => { const t = await r.text(); return r.ok && t.trimStart().startsWith('{') ? t : Promise.reject(r.status); })));
        if (r.length < 1000000) await env.SAFAR.put(key, r, { expirationTtl: 60 * 60 * 24 * 14 });
        return new Response(r, { headers: { 'Content-Type': 'application/json', 'X-Cache': 'miss', ...cors(req) } });
      }
      return json(req, { error: 'not found' }, 404);
    } catch (e) { return json(req, { error: 'server error' }, 500); }
  }
};
