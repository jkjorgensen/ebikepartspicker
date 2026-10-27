// Outbound click logger. Free. If an Analytics Engine dataset is bound as CLICKS
// (Pages project > Settings > Bindings), each click is stored; otherwise it is a no-op.
export async function onRequestPost({ request, env }) {
  try {
    const d = await request.json();
    const s = v => String(v || '').slice(0, 200);
    if (env.CLICKS) env.CLICKS.writeDataPoint({ blobs: [s(d.to), s(d.path), s(d.page)], indexes: [s(d.to).slice(0, 90)] });
  } catch (e) {}
  return new Response(null, { status: 204 });
}
