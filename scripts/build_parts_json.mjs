#!/usr/bin/env node
// Regenerate data/parts.json from data.js for the price/stock alert digest (/api/alerts-run).
// Run from the repo root after any data.js change (daily stock refresh, price job, catalog edits):
//   node scripts/build_parts_json.mjs
// Output: {generated, stock_checked, parts: {pid: {n, c, p, v, u, s, sc}}}
//   n  part name             c  category id (page = /parts/<c>/<pid>/)
//   p  best price (USD): lowest offer not marked out_of_stock, else lowest offer; null if none
//   v  store of that offer (emails link to the part page, which carries the buy links)
//   s  part-level stock (in_stock | out_of_stock | unknown | verify | '')   sc  stockChk date
// Hidden parts are left out. Read-only on data.js; no prices, stock or fitment are changed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8') +
  ';this.__C=CATEGORIES;this.__S=typeof STOCK_CHECKED!=="undefined"?STOCK_CHECKED:"";', ctx);

const parts = {};
for (const cat of ctx.__C) {
  for (const o of cat.options || []) {
    if (!o || !o.pid || o.hidden || parts[o.pid]) continue;
    const offers = (o.prices || []).filter(x => x && typeof x.p === 'number' && x.p > 0);
    const live = offers.filter(x => x.stock !== 'out_of_stock');
    const pool = live.length ? live : offers;
    const best = pool.reduce((a, x) => (!a || x.p < a.p ? x : a), null);
    parts[o.pid] = {
      n: o.name, c: cat.id,
      p: best ? best.p : null, v: best ? (best.v || '') : '',
      s: o.stock || '', sc: o.stockChk || '',
    };
  }
}
const out = { generated: new Date().toISOString().slice(0, 10), stock_checked: ctx.__S, count: Object.keys(parts).length, parts };
fs.writeFileSync(path.join(ROOT, 'data/parts.json'), JSON.stringify(out) + '\n');
console.log(`data/parts.json: ${out.count} parts`);
