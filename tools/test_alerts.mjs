// Offline test for the signup/alerts Functions (mock KV, mock Resend/Turnstile). Run: node tools/test_alerts.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const R = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sub = await import(R + '/functions/api/subscribe.js');
const conf = await import(R + '/functions/api/confirm.js');
const run = await import(R + '/functions/api/alerts-run.js');
const uns = await import(R + '/functions/api/unsubscribe.js');
const submit = await import(R + '/functions/api/submit.js');

class KV { constructor(){this.m=new Map();this.ops={put:0,get:0,list:0,del:0};}
  async get(k){this.ops.get++;return this.m.has(k)?this.m.get(k).v:null}
  async put(k,v,o={}){this.ops.put++;this.m.set(k,{v:typeof v==='string'?v:v,md:o.metadata??null})}
  async delete(k){this.ops.del++;this.m.delete(k)}
  async list({prefix='',cursor}={}){this.ops.list++;const keys=[...this.m.keys()].filter(k=>k.startsWith(prefix)).sort();const st=Number(cursor||0);const pg=keys.slice(st,st+1000);
    return {keys:pg.map(n=>({name:n,metadata:this.m.get(n).md})),list_complete:st+1000>=keys.length,cursor:String(st+1000)}}
}
let bikes = JSON.parse(fs.readFileSync(R+'/data/bikes.json','utf8'));
let parts = JSON.parse(fs.readFileSync(R+'/data/parts.json','utf8'));
const sent = [];
globalThis.fetch = async (u, init={}) => {
  u = String(u);
  if (u.includes('turnstile')) { const tok = init.body.get('response'); return new Response(JSON.stringify({success: tok==='good'})); }
  if (u === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); }
  if (u === 'https://api.resend.com/emails/batch') { const a=JSON.parse(init.body); sent.push(...a); return new Response(JSON.stringify({data:a.map(()=>({id:'x'}))})); }
  throw new Error('unexpected fetch '+u);
};
const ASSETS = { fetch: async (req) => { const p = new URL(req.url).pathname; if (p==='/data/bikes.json') return new Response(JSON.stringify(bikes)); if (p==='/data/parts.json') return new Response(JSON.stringify(parts)); return new Response('nf',{status:404}); } };
const ORIGIN = 'https://ebikepartspicker.net';
const full = () => ({ FORMS: kv, RESEND_API_KEY: 're_test', ALERT_RUN_TOKEN: 'tok123', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET: 'sec', ASSETS });
let kv = new KV();
const req = (path, method='GET', body, headers={}) => new Request(ORIGIN+path, { method, body: body && JSON.stringify(body), headers: { 'content-type':'application/json', ...headers } });
const js = async r => ({ status: r.status, body: await r.json() });

// --- graceful degrade
let r = await js(await sub.onRequestGet({ env: {} })); assert.equal(r.body.enabled, false); assert.equal(r.body.siteKey, null);
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'a@b.co',news:true}), env: { FORMS: kv } })); assert.equal(r.status, 503); assert.equal(r.body.enabled, false);
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST'), env: {} })); assert.equal(r.status, 401);
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env: { ALERT_RUN_TOKEN:'tok123' } })); assert.equal(r.status, 503); assert.equal(r.body.enabled, false);
r = await js(await run.onRequestGet({ env: {} })); assert.equal(r.body.enabled, false);
r = await js(await sub.onRequestGet({ env: full() })); assert.equal(r.body.enabled, true); assert.equal(r.body.siteKey, 'site');
console.log('degrade ok');

// --- validation
const env = full();
const P = Object.keys(parts.parts).find(k => parts.parts[k].s==='out_of_stock' && parts.parts[k].p);
const P2 = Object.keys(parts.parts).find(k => parts.parts[k].s==='in_stock' && parts.parts[k].p > 300);
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'bad',news:true,turnstile:'good'}), env })); assert.equal(r.body.error,'bad_email');
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'x@y.com',turnstile:'good'}), env })); assert.equal(r.body.error,'nothing_selected');
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'x@y.com',news:true,turnstile:'bad'}), env })); assert.equal(r.status,403);
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'x@y.com',bike:'nope',turnstile:'good'}), env })); assert.equal(r.body.error,'unknown_bike');
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'x@y.com',news:true,website:'spam',turnstile:'good'}), env })); assert.equal(r.body.ok,true); assert.equal(kv.m.size,0);
console.log('validation ok');

// --- signup
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'Rider@Example.com',news:'1',bike:'ultrabee',part:P,part_price:true,part_stock:true,page:'/parts/x/',turnstile:'good'}), env }));
assert.equal(r.body.ok, true, JSON.stringify(r));
assert.equal(sent.length, 1); assert.match(sent[0].subject, /Confirm/);
console.log('keys after signup:', [...kv.m.keys()]);
const link = sent[0].text.match(/https:\/\/ebikepartspicker\.net\/api\/confirm\?token=\S+/)[0];
const token = decodeURIComponent(new URL(link).searchParams.get('token'));
// resend cooldown: second signup within 10 min sends nothing new
r = await js(await sub.onRequestPost({ request: req('/api/subscribe','POST',{email:'rider@example.com',part:P2,part_price:'on',turnstile:'good'}), env })); assert.equal(sent.length,1);
// run before confirming: nothing sent
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); assert.equal(r.body.sent,0); assert.equal(r.body.confirmed,0);
// confirm: GET shows button and doesn't confirm
let h = await conf.onRequestGet({ request: new Request(link), env }); assert.equal(h.status,200); assert.equal(JSON.parse(kv.m.get('sub:rider@example.com').v).confirmed_at, null);
h = await conf.onRequestGet({ request: new Request(ORIGIN+'/api/confirm?token=garbage'), env }); assert.equal(h.status,400);
const fd = new FormData(); fd.append('token', token);
h = await conf.onRequestPost({ request: new Request(ORIGIN+'/api/confirm',{method:'POST',body:fd}), env }); assert.equal(h.status,200); console.log('confirm page:', (await h.text()).match(/<p>You're set.*?<\/p>/)[0]);
assert.ok(JSON.parse(kv.m.get('sub:rider@example.com').v).confirmed_at);
for (const [k,v] of kv.m) if (k.startsWith('w:')) assert.equal(JSON.parse(v.v).active, true, k);

// --- run 1: nothing changed -> no email; news first_seen initialised
const before = sent.length;
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); console.log('run1', r.body); assert.equal(sent.length, before); assert.ok(kv.m.has('meta:news:first_seen'));

// --- change catalog: bike drops $500, part P restocks, P2 drops 2% but >= $5, new part + bike appear
const ub = bikes.bikes.find(b=>b.id==='ultrabee'); const ubWas = ub.price_usd; ub.price_usd = ubWas - 500;
parts.parts[P].s = 'in_stock';
const p2was = parts.parts[P2].p; parts.parts[P2].p = Math.round((p2was - 6)*100)/100;
parts.parts['zz-new-test-part'] = { n:'Test New Part', c:'motor', p:99, v:'Store', s:'in_stock', sc:'' };
// news only fires >28d after last news / since confirm date; fake confirm date older + first_seen date
const nk = 'w:rider@example.com:news'; const nr = JSON.parse(kv.m.get(nk).v); nr.confirmed='2026-10-01T00:00:00Z'; nr.created='2026-10-01T00:00:00Z'; kv.m.set(nk,{v:JSON.stringify(nr),md:nr});
// dry run first
r = await js(await run.onRequestPost({ request: req('/api/alerts-run?dry=1','POST',null,{authorization:'Bearer tok123'}), env })); console.log('dry', JSON.stringify(r.body,null,1)); assert.equal(sent.length, before);
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); console.log('run2', r.body);
assert.equal(sent.length, before+1); const d = sent.at(-1);
console.log('SUBJECT', d.subject); console.log(d.text);
assert.ok(d.headers['List-Unsubscribe']);
if (process.env.DIGEST_HTML) fs.writeFileSync(process.env.DIGEST_HTML, d.html);
// --- run 3 immediately: rate limited, nothing sent
ub.price_usd = ubWas - 900;
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); console.log('run3', r.body); assert.equal(sent.length, before+1); assert.ok(r.body.rate_limited>=1);

// --- per-watch unsubscribe via link in digest
const one = d.text.match(/Stop this alert: (\S+)/)[1];
let u = await uns.onRequestGet({ request: new Request(one), env }); assert.equal(u.status,200);
const wleft = [...kv.m.keys()].filter(k=>k.startsWith('w:')); console.log('watches left', wleft);
// --- global one-click unsubscribe
const all = d.headers['List-Unsubscribe'].slice(1,-1);
u = await uns.onRequestPost({ request: new Request(all,{method:'POST',body:'List-Unsubscribe=One-Click',headers:{'content-type':'application/x-www-form-urlencoded'}}), env }); assert.equal(u.status,200);
assert.equal([...kv.m.keys()].filter(k=>k.startsWith('w:')).length, 0); assert.equal(JSON.parse(kv.m.get('sub:rider@example.com').v).unsub_all, true);
// confirm token can't be used to unsubscribe
u = await uns.onRequestGet({ request: new Request(ORIGIN+'/api/unsubscribe?token='+encodeURIComponent(token)), env }); assert.match(await u.text(), /invalid/);

// --- legacy alert migration
r = await js(await submit.onRequestPost({ request: req('/api/submit','POST',{type:'alert',email:'old@site.com',bike:'mx4',build:''}), env })); assert.equal(r.body.ok,true);
assert.ok(kv.m.has('alert:old@site.com:mx4'));
const n0 = sent.length;
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); console.log('run-legacy', r.body);
assert.ok(!kv.m.has('alert:old@site.com:mx4')); assert.ok(kv.m.has('w:old@site.com:bike_price:mx4')); assert.equal(sent.length, n0+1); assert.match(sent.at(-1).subject,/Confirm/);
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env })); assert.equal(sent.length, n0+1); // only one confirm
// legacy unsubscribe link format still works
const { makeUnsubToken } = await import(R+'/functions/_lib/unsub-token.js');
const lt = await makeUnsubToken('tok123','old@site.com','mx4');
u = await uns.onRequestGet({ request: new Request(ORIGIN+'/api/unsubscribe?token='+encodeURIComponent(lt)), env }); assert.equal(u.status,200);
assert.ok(!kv.m.has('w:old@site.com:bike_price:mx4'));
// no RESEND key: evaluates, sends nothing
r = await js(await run.onRequestPost({ request: req('/api/alerts-run','POST',null,{authorization:'Bearer tok123'}), env: { ...env, RESEND_API_KEY: undefined } })); assert.equal(r.body.sending,false);
console.log('KV ops', kv.ops);
console.log('ALL TESTS PASSED');
