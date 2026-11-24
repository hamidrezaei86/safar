// Safar connector for Claude and ChatGPT (Model Context Protocol, streamable HTTP, stateless).
// Tools: plan_trip (day-by-day outline + a link that opens the trip in Safar) and find_sights.
import { EVENT, EVT_T, EXCL, PLACE } from './sightfilters.js';

const APP = 'https://safar.amovasolutions.com/';
const UA = { 'User-Agent': 'Safar/1.0 (+https://safar.amovasolutions.com/; trip planner)' };
const W = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*';
const PER_DAY = { relaxed: 4, balanced: 5, packed: 7 };
const MODES = { walk: ['walk', 'metro', 'bus', 'taxi', 'uber'], transit: ['walk', 'metro', 'bus'], drive: ['walk', 'drive', 'taxi'] };

const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
const get = async (u, ms = 12000) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error('lookup failed ' + r.status); return r.json(); };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const isoOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function geocode(q, near, extra = '') {
  const j = await get(`https://photon.komoot.io/api/?lang=en&limit=1&q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lon=${near.lng}` : ''}${extra}`);
  const f = j.features?.[0]; if (!f) return null; const p = f.properties;
  return { name: p.name || q, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], sub: [p.state, p.country].filter(Boolean).join(', '), extent: p.extent || null, country: p.country || '' };
}
const EMO = [[/museum|musée|museo|gallery|galleria/i, '🏛️', 120], [/cathedral|basilica|church|chapel|abbey|mosque|synagogue|temple|shrine|monastery/i, '⛪', 45], [/palace|palazzo|palais|château|castle|fort|citadel/i, '🏰', 90],
  [/park|garden|jardin|parco|parc/i, '🌳', 60], [/fountain|fontana|square|piazza|plaza|place/i, '⛲', 25], [/bridge|tower|torre|tour|arch|gate|monument|memorial|statue|column|obelisk/i, '🗼', 30], [/ruin|ancient|forum|amphitheat|theatre|theater/i, '🏛️', 75]];
const kind = t => EMO.find(([re]) => re.test(t)) || [null, '📍', 60];

export async function findSights(city, limit = 20) {
  const s = await get(`${W}&list=search&srsearch=${encodeURIComponent(`nearcoord:7km,${city.lat},${city.lng}`)}&srsort=incoming_links_desc&srlimit=120&srprop=&srnamespace=0`);
  let hits = s.query?.search || [];
  if (hits.length < 30) hits = hits.concat((await get(`${W}&list=search&srsearch=${encodeURIComponent(`nearcoord:30km,${city.lat},${city.lng}`)}&srsort=incoming_links_desc&srlimit=80&srprop=&srnamespace=0`)).query?.search || []);
  const ids = [...new Set(hits.filter(h => !EXCL.test(h.title) && !EVT_T.test(h.title)).map(h => h.pageid))].slice(0, 100);
  const pages = [];
  for (let i = 0; i < ids.length; i += 50) { const j = await get(`${W}&pageids=${ids.slice(i, i + 50).join('%7C')}&prop=description%7Ccoordinates&colimit=max&coprimary=primary`); pages.push(...(j.query?.pages || [])); }
  const rank = new Map(ids.map((id, i) => [id, i]));
  const NOT = /\b(dicastery|curia|religious order|order founded|congregation|department|ministry|stadium|arena|football|club|team|company|organi[sz]ation|association)\b/i;
  return pages.filter(p => p.coordinates?.length && !NOT.test(p.description || '') && !EXCL.test(p.description || '') && !EVENT.test(p.description || '') && PLACE.test((p.description || '') + ' ' + p.title) && p.title.toLowerCase() !== city.name.toLowerCase())
    .sort((a, b) => rank.get(a.pageid) - rank.get(b.pageid)).slice(0, limit)
    .map(p => { const [, emoji, dur] = kind((p.description || '') + ' ' + p.title);
      return { name: p.title, about: p.description || '', lat: p.coordinates[0].lat, lng: p.coordinates[0].lon, wid: p.pageid, emoji, minutes: dur, wiki: 'https://en.wikipedia.org/?curid=' + p.pageid }; });
}

// split places into `days` groups that are close together, then order each group by walking order
function splitDays(pts, days) {
  if (days <= 1 || pts.length <= 1) return [order(pts)];
  let cen = pts.slice().sort((a, b) => a.lng - b.lng).filter((_, i, a) => i % Math.ceil(a.length / days) === 0).slice(0, days).map(p => ({ lat: p.lat, lng: p.lng })), grp;
  for (let it = 0; it < 12; it++) {
    grp = cen.map(() => []); const cap = Math.ceil(pts.length / days) + 1;
    for (const p of pts.slice().sort((a, b) => Math.min(...cen.map(c => hav(a, c))) - Math.min(...cen.map(c => hav(b, c))))) {
      const best = cen.map((c, i) => [hav(p, c), i]).sort((a, b) => a[0] - b[0]).find(([, i]) => grp[i].length < cap) || [0, 0]; grp[best[1]].push(p); }
    cen = grp.map((g, i) => g.length ? { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lng, 0) / g.length } : cen[i]);
  }
  return grp.filter(g => g.length).map(order);
}
function order(g) { if (g.length < 3) return g; const rest = g.slice(), out = [rest.splice(rest.reduce((bi, p, i, a) => p.lng < a[bi].lng ? i : bi, 0), 1)[0]];
  while (rest.length) { const last = out[out.length - 1]; let bi = 0; rest.forEach((p, i) => { if (hav(last, p) < hav(last, rest[bi])) bi = i; }); out.push(rest.splice(bi, 1)[0]); } return out; }

async function packTrip(trip) {
  const body = JSON.stringify({ trip, role: 'edit', from: 'Your AI assistant', at: Date.now() });
  const buf = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return APP + '#trip=z' + btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function planTrip(a) {
  const dests = (Array.isArray(a.destinations) ? a.destinations : []).slice(0, 6);
  if (!dests.length) throw new Error('Give at least one destination, for example {"city": "Rome", "nights": 3}.');
  const pace = PER_DAY[a.pace] ? a.pace : 'balanced', start = isoOk(a.start_date) ? a.start_date : addDays(new Date().toISOString().slice(0, 10), 14);
  const cities = [], places = [], lines = []; let dayNo = 0;
  for (const d of dests) {
    const nights = Math.max(1, Math.min(14, Math.round(+d.nights || 2)));
    const c = await geocode(String(d.city || '').slice(0, 100), null, '&osm_tag=place'); if (!c) throw new Error(`Could not find "${d.city}".`);
    const cid = 'c' + slug(c.name) + cities.length; cities.push({ id: cid, name: c.name, sub: c.sub, lat: c.lat, lng: c.lng, ...(c.extent ? { extent: c.extent } : {}), nights });
    const want = (Array.isArray(d.places) ? d.places : []).slice(0, 25).map(x => String(x).slice(0, 120)).filter(Boolean);
    const asked = (await Promise.all(want.map(q => geocode(q, c).catch(() => null)))).filter(p => p && hav(p, c) < 60000).map(p => { const [, emoji, minutes] = kind(p.name); return { name: p.name, lat: p.lat, lng: p.lng, emoji, minutes, asked: true }; });
    const top = await findSights(c, nights * PER_DAY[pace] + 6).catch(() => []);
    const pool = asked.concat(top.filter(t => !asked.some(q => hav(q, t) < 120))).slice(0, nights * PER_DAY[pace]);
    pool.forEach((p, i) => places.push({ id: 'p' + cities.length + '_' + i, city: cid, name: p.name.slice(0, 200), lat: p.lat, lng: p.lng, type: 'stop', duration: p.minutes, priority: p.asked || i < nights * 3 ? 'must' : 'nice', open: '', close: '', fixed: '', pin: '', emoji: p.emoji, img: '', wid: p.wid || null, cat: '', auto: false }));
    lines.push(`## ${c.name}${c.sub ? ', ' + c.sub.split(', ').pop() : ''} — ${nights} night${nights > 1 ? 's' : ''}`);
    splitDays(pool, nights).forEach(g => { const date = addDays(start, dayNo++), km = g.slice(1).reduce((s, p, i) => s + hav(g[i], p), 0) / 1000;
      lines.push(`**Day ${dayNo} · ${new Date(date + 'T12:00:00Z').toUTCString().slice(0, 11)}** (about ${km < 1 ? 'under 1' : km.toFixed(1)} km between stops)`, ...g.map(p => `- ${p.emoji} ${p.name}${p.about ? ' — ' + p.about : ''}`)); });
  }
  const trip = { v: 2, step: 'plan', cities, cur: cities[0].id, legs: {}, hubs: {}, places, dayCfg: {}, picks: {}, settings: { startDate: start, pace, modes: MODES[a.travel_mode] || MODES.walk, mode: a.travel_mode === 'drive' ? 'car' : 'foot' } };
  const link = await packTrip(trip);
  return { text: `${lines.join('\n')}\n\nThis outline groups nearby sights by day. Open the trip in Safar, choose a hotel, and Safar works out exact times, meals, breaks, routes and live navigation:\n${link}`,
    data: { start_date: start, pace, days: dayNo, cities: cities.map(c => ({ name: c.name, nights: c.nights })), open_in_safar: link } };
}

const TOOLS = [
  { name: 'plan_trip', title: 'Plan a trip with Safar',
    description: 'Plans a multi-city trip day by day: finds the best-known sights in each city, groups nearby ones into days, and returns an outline plus a link that opens the full plan in the Safar app (with timings, meals, breaks, routes and navigation). Use when someone wants an itinerary.',
    inputSchema: { type: 'object', required: ['destinations'], properties: {
      destinations: { type: 'array', minItems: 1, maxItems: 6, description: 'Cities in travel order', items: { type: 'object', required: ['city'], properties: {
        city: { type: 'string', description: 'City name, e.g. "Rome" or "Kyoto, Japan"' }, nights: { type: 'integer', minimum: 1, maximum: 14, description: 'Nights in this city (default 2)' },
        places: { type: 'array', items: { type: 'string' }, description: 'Places the traveller definitely wants to visit there (optional)' } } } },
      start_date: { type: 'string', description: 'First day, YYYY-MM-DD (default: two weeks from today)' },
      pace: { type: 'string', enum: ['relaxed', 'balanced', 'packed'], description: 'How full each day is (default balanced)' },
      travel_mode: { type: 'string', enum: ['walk', 'transit', 'drive'], description: 'How they get around inside cities (default walk)' } } },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'find_sights', title: 'Find top sights in a city',
    description: 'Lists the best-known sights in or near a city (from Wikipedia), with a one-line description, coordinates and a suggested visit length.',
    inputSchema: { type: 'object', required: ['city'], properties: { city: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 40, description: 'How many (default 15)' } } },
    annotations: { readOnlyHint: true, openWorldHint: true } },
];

async function callTool(name, a = {}) {
  if (name === 'plan_trip') { const r = await planTrip(a); return { content: [{ type: 'text', text: r.text }], structuredContent: r.data }; }
  if (name === 'find_sights') { const c = await geocode(String(a.city || '').slice(0, 100), null, '&osm_tag=place'); if (!c) throw new Error(`Could not find "${a.city}".`);
    const list = await findSights(c, Math.max(1, Math.min(40, +a.limit || 15)));
    return { content: [{ type: 'text', text: `Top sights in ${c.name}${c.sub ? ', ' + c.sub : ''}:\n` + list.map((s, i) => `${i + 1}. ${s.emoji} ${s.name}${s.about ? ' — ' + s.about : ''} (about ${s.minutes} min)`).join('\n') }], structuredContent: { city: c.name, sights: list } }; }
  throw Object.assign(new Error('Unknown tool: ' + name), { code: -32602 });
}

const INFO = { name: 'safar', title: 'Safar trip planner', version: '1.0.0' };
const INSTR = 'Safar plans trips day by day. Call plan_trip with the cities, nights and start date; share the outline and the "open in Safar" link. Use find_sights for ideas about one city.';
const reply = (id, result) => ({ jsonrpc: '2.0', id, result }), fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(m?.id ?? null, -32600, 'Invalid request');
  const isNote = m.id === undefined;
  try {
    switch (m.method) {
      case 'initialize': return reply(m.id, { protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(m.params?.protocolVersion) ? m.params.protocolVersion : '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: INFO, instructions: INSTR });
      case 'ping': return reply(m.id, {});
      case 'tools/list': return reply(m.id, { tools: TOOLS });
      case 'tools/call': try { return reply(m.id, await callTool(m.params?.name, m.params?.arguments || {})); }
        catch (e) { if (e.code) return fail(m.id, e.code, e.message); return reply(m.id, { content: [{ type: 'text', text: 'Safar could not do that: ' + e.message }], isError: true }); }
      case 'resources/list': return reply(m.id, { resources: [] });
      case 'prompts/list': return reply(m.id, { prompts: [] });
      default: return isNote ? null : fail(m.id, -32601, 'Method not found: ' + m.method);
    }
  } catch (e) { return isNote ? null : fail(m.id, -32603, 'Internal error'); }
}

const MH = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Accept,Authorization,Mcp-Session-Id,Mcp-Protocol-Version', 'Access-Control-Expose-Headers': 'Mcp-Session-Id', 'Cache-Control': 'no-store' };
export async function mcp(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: MH });
  if (req.method === 'GET') return new Response(JSON.stringify({ name: INFO.title, transport: 'streamable-http', endpoint: '/mcp', tools: TOOLS.map(t => t.name) }), { status: req.headers.get('Accept')?.includes('text/event-stream') ? 405 : 200, headers: { ...MH, 'Content-Type': 'application/json', Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: MH });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: MH });
  const t = await req.text(); if (t.length > 100000) return new Response('Too large', { status: 413, headers: MH });
  let body; try { body = JSON.parse(t); } catch (e) { return new Response(JSON.stringify(fail(null, -32700, 'Parse error')), { status: 400, headers: { ...MH, 'Content-Type': 'application/json' } }); }
  const out = Array.isArray(body) ? (await Promise.all(body.map(handle))).filter(Boolean) : await handle(body);
  if (!out || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: MH });
  return new Response(JSON.stringify(out), { headers: { ...MH, 'Content-Type': 'application/json' } });
}
