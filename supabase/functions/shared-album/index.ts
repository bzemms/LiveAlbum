// Share links for people without an account.
//   GET /functions/v1/shared-album?token=<share token>
// Looks the token up through public.get_shared_album (which already hides the owner's home area),
// then signs short-lived URLs for the album's files. The storage bucket itself stays private.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const SIGN_SECONDS = 60 * 60; // one hour; the page asks again when it reloads
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return json({ error: 'not found' }, 404);

  // Service role only to sign URLs; what is visible is decided by get_shared_album.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin.rpc('get_shared_album', { p_token: token });
  if (error) return json({ error: 'unavailable' }, 500);
  if (!data) return json({ error: 'not found' }, 404);

  const items = data.items as Array<Record<string, string | null>>;
  const paths = items.flatMap((m) => [m.path_display, m.path_thumb, m.path_video].filter(Boolean) as string[]);
  const signed = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data: urls, error: signErr } = await admin.storage.from('media').createSignedUrls(paths.slice(i, i + 100), SIGN_SECONDS);
    if (signErr) return json({ error: 'unavailable' }, 500);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  return json({
    album: data.album,
    expires_in: SIGN_SECONDS,
    items: items.map(({ path_display, path_thumb, path_video, ...rest }) => ({
      ...rest,
      display_url: path_display ? signed.get(path_display) ?? null : null,
      thumb_url: path_thumb ? signed.get(path_thumb) ?? null : null,
      video_url: path_video ? signed.get(path_video) ?? null : null,
    })),
  });
});
