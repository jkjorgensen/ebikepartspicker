// Outbound BUY-click logger (per part, per store, per bike, per page). Free.
// Writes to the same CLICKS Analytics Engine binding (dataset ebpp_clicks) as /api/click,
// with index1 = 'buy' so it never mixes with page views or the legacy host/path clicks.
// No personal data: no IP, cookies or user id are stored.
//
// Data point layout (read by /api/stats and scripts/query_stats.py):
//   index1 'buy'
//   blob1  'buy'            event marker
//   blob2  part id          ('' if it could not be determined)
//   blob3  store            host without www (Voro sjv.io links = the real store host)
//   blob4  bike id          ('' if none, e.g. a part page)
//   blob5  page             path the click happened on
//   blob6  store path       product path on the store
//   blob7  'aff' | ''       link carried an affiliate redirect
//   blob8  part id source   'dom' | 'page' | 'lookup' | 'none'
//   blob9  candidates       'a|b' when one store URL backs several parts and nothing disambiguated
//   blob10 kind             'part' | 'bike'
//   double1 1
import INDEX from '../_lib/buy-index.json';

const ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const s = (v, n = 200) => String(v == null ? '' : v).slice(0, n);
const id = v => { v = s(v, 120).toLowerCase(); return ID.test(v) ? v : ''; };

export function buildPoint(d) {
  const store = s(d.to, 120).toLowerCase().replace(/^www\./, '').replace(/\s*\(affiliate\)$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(store)) return null; // not a real host: ignore
  const spath = s(d.path);
  const page = s(d.page);
  const kind = d.kind === 'bike' ? 'bike' : 'part';
  let pid = '', src = 'none', cands = '';
  if (kind === 'part') {
    const m = page.match(/^\/parts\/[^/]+\/([^/]+)/);
    if (id(d.pid)) { pid = id(d.pid); src = 'dom'; }
    else if (m && id(m[1])) { pid = id(m[1]); src = 'page'; }
    else {
      const hit = INDEX[store + spath.replace(/\/+$/, '')];
      if (typeof hit === 'string') { pid = hit; src = 'lookup'; }
      else if (Array.isArray(hit)) cands = hit.join('|').slice(0, 200);
    }
  }
  return {
    indexes: ['buy'],
    blobs: ['buy', pid, store, id(d.bike), page, spath, d.aff ? 'aff' : '', src, cands, kind],
    doubles: [1],
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const d = await request.json();
    const pt = buildPoint(d);
    if (pt && env.CLICKS) env.CLICKS.writeDataPoint(pt);
  } catch (e) {}
  return new Response(null, { status: 204 });
}
