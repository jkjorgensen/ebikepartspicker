// Page-view logger. Free. Uses the existing CLICKS Analytics Engine binding
// (dataset ebpp_clicks). No personal data: path, kind, and optional id only.
export async function onRequestPost({ request, env }) {
  try {
    const d = await request.json();
    const s = v => String(v || '').slice(0, 200);
    const kind = s(d.kind || 'other');
    if (env.CLICKS) {
      env.CLICKS.writeDataPoint({
        blobs: ['view', s(d.page), kind, s(d.id), s(d.view)],
        doubles: [1],
        indexes: ['view'],
      });
    }
  } catch (e) {}
  return new Response(null, { status: 204 });
}
