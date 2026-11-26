// The private cloud: sign-in by email, albums, uploads and edits, through Supabase.
// What each person can see is enforced by the database's row-level security
// (supabase/migrations), not by this file: the publishable key below is meant to be public.
import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL || 'https://setaomcxdygjztmrwjlp.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Y9mksU5y4TCWRiu7oLWLGQ_xk6Jfgsj';
const BUCKET = 'media';
const SIGN_SECONDS = 6 * 60 * 60;

export const sb = createClient(URL_, KEY, {
  // 'implicit': the email link signs in whichever browser opens it (phones often open mail links in
  // a different browser than the one that asked, which breaks the PKCE flow).
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

// ---------- Accounts ----------
export function onUser(cb) {
  sb.auth.getSession().then(({ data }) => cb(data.session?.user ?? null));
  sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}

/** Email a sign-in link (and a 6-digit code, if the email template includes {{ .Token }}). */
export async function sendSignInEmail(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw error;
}

/** Sign in with the code from the email (handy on phones, where the link may open another browser). */
export async function verifyCode(email, code) {
  const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) throw error;
}

export const signOut = () => sb.auth.signOut();

// ---------- Albums ----------
export async function listAlbums() {
  const { data, error } = await sb
    .from('albums')
    .select('id, title, owner_id, created_at, album_members(role, user_id)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const { data: u } = await sb.auth.getUser();
  return data.map((a) => ({ id: a.id, title: a.title, role: a.album_members.find((m) => m.user_id === u.user?.id)?.role || 'viewer' }));
}

export async function createAlbum(title) {
  const { data, error } = await sb.from('albums').insert({ title }).select('id, title').single();
  if (error) throw error;
  return { ...data, role: 'owner' };
}

// ---------- Media ----------
async function sign(paths) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), SIGN_SECONDS);
    if (error) throw error;
    for (const s of data) if (s.signedUrl) out.set(s.path, s.signedUrl);
  }
  return out;
}

/** An album's media as album items (same shape the globe and the street use). */
export async function loadAlbum(albumId) {
  const { data, error } = await sb
    .from('media')
    .select('id, kind, path_display, path_thumb, path_video, taken_at, lat, lng, place, caption, duration_s, created_at')
    .eq('album_id', albumId)
    .order('taken_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  const urls = await sign(data.flatMap((m) => [m.path_display, m.path_thumb, m.path_video].filter(Boolean)));
  return data.map((m) => ({
    id: m.id,
    cloudId: m.id,
    name: m.caption || '',
    place: m.place,
    date: m.taken_at ? new Date(m.taken_at) : null,
    lat: m.lat,
    lng: m.lng,
    thumb: urls.get(m.path_thumb),
    full: urls.get(m.path_display),
    video: m.path_video ? urls.get(m.path_video) : null,
    playable: true,
    duration: m.duration_s,
  }));
}

const extOf = (file) => (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'mp4').toLowerCase();

/**
 * Upload one item that was read on this device (`item` from readPhoto/readVideo, `file` its source).
 * Stores a display image, a thumbnail and, for videos, the video file, then the media row.
 */
export async function uploadItem(albumId, item, file) {
  const id = crypto.randomUUID();
  const dir = `${albumId}/${id}`;
  const blobOf = async (url) => (await fetch(url)).blob();
  const [display, thumb] = await Promise.all([blobOf(item.full), blobOf(item.thumb)]);
  const files = [
    [`${dir}/display.jpg`, display, 'image/jpeg'],
    [`${dir}/thumb.jpg`, thumb, 'image/jpeg'],
  ];
  let pathVideo = null;
  if (item.video) {
    pathVideo = `${dir}/video.${extOf(file)}`;
    files.push([pathVideo, file, file.type || 'video/mp4']);
  }
  const done = [];
  try {
    for (const [path, body, contentType] of files) {
      const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: '31536000' });
      if (error) throw error;
      done.push(path);
    }
    const size = files.reduce((s, [, b]) => s + (b.size || 0), 0);
    const { error } = await sb.from('media').insert({
      id,
      album_id: albumId,
      kind: item.video ? 'video' : 'photo',
      path_display: `${dir}/display.jpg`,
      path_thumb: `${dir}/thumb.jpg`,
      path_video: pathVideo,
      mime: file.type || null,
      size_bytes: size,
      duration_s: item.duration || null,
      taken_at: item.date ? item.date.toISOString() : null,
      lat: item.lat,
      lng: item.lng,
      place: item.place,
      location_source: item.lat == null ? 'none' : 'exif',
    });
    if (error) throw error;
    return id;
  } catch (e) {
    if (done.length) await sb.storage.from(BUCKET).remove(done).catch(() => {});
    throw e;
  }
}

export async function updateMedia(id, fields) {
  const { error } = await sb.from('media').update(fields).eq('id', id);
  if (error) throw error;
}

/** Short, human message for an upload error. */
export function uploadErrorText(e) {
  const msg = String(e?.message || e || '');
  if (/exceeded|too large|payload|413/i.test(msg)) return 'הקובץ גדול מדי למסלול הנוכחי (עד 50MB לקובץ בחינם).';
  if (/row-level security|permission|42501|403/i.test(msg)) return 'אין לך הרשאה להוסיף לאלבום הזה.';
  return 'ההעלאה נכשלה. בדקו את החיבור ונסו שוב.';
}
