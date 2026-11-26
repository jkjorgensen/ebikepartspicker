#!/usr/bin/env node
/* Builds functions/_lib/buy-index.json: store product URL -> part id, from data.js.
   Used by /api/buy to fill in the part id when the browser could not supply one
   (static pages have no part id on their buy links). Run after catalog edits:
     node scripts/build_buy_index.js
   Key = store host (no www) + product path (no query, no trailing slash);
   Voro sjv.io links are unwrapped to the real store URL first.
   Value = part id, or an array of ids when the same store URL backs several parts. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8') + ';this.CATEGORIES=CATEGORIES;', ctx);
const m = {};
for (const c of ctx.CATEGORIES) for (const o of (c.options || [])) {
  if (!o || !o.pid) continue;
  for (const p of (o.prices || [])) {
    if (!p.url) continue;
    let u; try { u = new URL(p.url); } catch (e) { continue; }
    if (/sjv\.io$/.test(u.host)) { const t = u.searchParams.get('u'); if (t) { try { u = new URL(t); } catch (e) { continue; } } }
    const k = u.host.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
    (m[k] = m[k] || new Set()).add(o.pid);
  }
}
const out = {};
for (const k of Object.keys(m).sort()) { const v = [...m[k]].sort(); out[k] = v.length === 1 ? v[0] : v; }
fs.writeFileSync(path.join(root, 'functions', '_lib', 'buy-index.json'), JSON.stringify(out));
console.log(Object.keys(out).length + ' store URLs indexed, ' + Object.values(out).filter(Array.isArray).length + ' ambiguous');
