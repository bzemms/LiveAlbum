-- LiveAlbum: albums, members, media, invites and share links, with row-level security.
--
-- The rule everywhere: you see an album, its members, its media and its files only if you are a
-- member of that album. Roles: viewer < editor < owner.
--   viewer  sees the album
--   editor  also adds media, edits captions and places, creates share links
--   owner   also manages members and invites, and deletes the album
-- Files live in the private "media" bucket at  <album_id>/<media_id>/<file>  and follow the same
-- rule. Share links never touch the tables directly: a SECURITY DEFINER function returns only what
-- the link allows (with the owner's home area hidden), and an edge function signs the file URLs.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.album_role as enum ('viewer', 'editor', 'owner'); -- order matters: viewer < editor < owner
create type public.media_kind as enum ('photo', 'video');
create type public.location_source as enum ('exif', 'manual', 'none');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- Public face of a user: what other members of a shared album may see.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Private per-user settings. Only the user reads or writes their own row.
-- home_* marks the area hidden from share links (so a public link never shows where a family lives).
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  home_lat double precision check (home_lat between -90 and 90),
  home_lng double precision check (home_lng between -180 and 180),
  home_radius_m integer not null default 500 check (home_radius_m between 50 and 20000),
  updated_at timestamptz not null default now()
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  cover_media_id uuid, -- foreign key added after media exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.album_members (
  album_id uuid not null references public.albums (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.album_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (album_id, user_id)
);
create index album_members_user_idx on public.album_members (user_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  uploader_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind public.media_kind not null,
  -- Storage paths inside the "media" bucket, all under <album_id>/<id>/
  path_display text not null,      -- photo: ~2560 px JPEG; video: poster frame
  path_thumb text not null,        -- ~320 px JPEG
  path_video text,                 -- the video file itself (kind = 'video')
  path_original text,              -- optional untouched original
  mime text,
  size_bytes bigint not null default 0 check (size_bytes >= 0), -- total of all files, for quotas
  width integer,
  height integer,
  duration_s real,
  taken_at timestamptz,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  place text,
  location_source public.location_source not null default 'none',
  caption text check (char_length(caption) <= 500),
  story text check (char_length(story) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (kind = 'photo' or path_video is not null)
);
create index media_album_taken_idx on public.media (album_id, taken_at);

alter table public.albums
  add constraint albums_cover_fk foreign key (cover_media_id) references public.media (id) on delete set null;

-- Invitations by email, so family members can be invited before they have an account.
create table public.album_invites (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.album_role not null default 'viewer' check (role <> 'owner'),
  token text not null unique default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index album_invites_email_idx on public.album_invites (lower(email));

-- View-only links for people without an account (e.g. grandparents).
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  token text not null unique default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hide_home boolean not null default true,
  expires_at timestamptz,          -- null: until revoked
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies can ask about membership without recursing into RLS)
-- ---------------------------------------------------------------------------------------------
create function public.album_role_of(p_album uuid)
returns public.album_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.album_members m where m.album_id = p_album and m.user_id = auth.uid()
$$;

create function public.has_album_role(p_album uuid, p_min public.album_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.album_role_of(p_album) >= p_min, false)
$$;

-- Storage paths start with the album id; a malformed path must not raise inside a policy.
create function public.try_uuid(p text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger albums_touch before update on public.albums for each row execute function public.touch_updated_at();
create trigger media_touch before update on public.media for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings for each row execute function public.touch_updated_at();

-- A new user gets a profile and settings row.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- The creator of an album becomes its owner member.
create function public.handle_new_album()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.album_members (album_id, user_id, role, invited_by) values (new.id, new.owner_id, 'owner', new.owner_id);
  return new;
end;
$$;
create trigger on_album_created after insert on public.albums for each row execute function public.handle_new_album();

-- The owner id never changes through a plain update (ownership transfer would be its own function).
create function public.keep_album_owner()
returns trigger language plpgsql set search_path = ''
as $$ begin new.owner_id := old.owner_id; return new; end; $$;
create trigger albums_keep_owner before update on public.albums for each row execute function public.keep_album_owner();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.albums enable row level security;
alter table public.album_members enable row level security;
alter table public.media enable row level security;
alter table public.album_invites enable row level security;
alter table public.share_links enable row level security;

-- profiles: yourself, and people you share an album with.
create policy "profiles: self and album mates" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.album_members a join public.album_members b on a.album_id = b.album_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_settings: only yourself.
create policy "settings: self" on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- albums. (owner_id = auth.uid() also lets INSERT ... RETURNING see the new row before the
-- membership trigger's row is visible.)
create policy "albums: members read" on public.albums for select to authenticated
  using (owner_id = auth.uid() or public.has_album_role(id, 'viewer'));
create policy "albums: create own" on public.albums for insert to authenticated
  with check (owner_id = auth.uid());
create policy "albums: editors update" on public.albums for update to authenticated
  using (public.has_album_role(id, 'editor')) with check (public.has_album_role(id, 'editor'));
create policy "albums: owner deletes" on public.albums for delete to authenticated
  using (public.has_album_role(id, 'owner'));

-- album_members: members see each other; the owner manages everyone but the owner; anyone but the
-- owner may leave.
create policy "members: read" on public.album_members for select to authenticated
  using (public.has_album_role(album_id, 'viewer'));
create policy "members: owner adds" on public.album_members for insert to authenticated
  with check (public.has_album_role(album_id, 'owner') and role <> 'owner');
create policy "members: owner changes roles" on public.album_members for update to authenticated
  using (public.has_album_role(album_id, 'owner') and role <> 'owner')
  with check (public.has_album_role(album_id, 'owner') and role <> 'owner');
create policy "members: owner removes or self leaves" on public.album_members for delete to authenticated
  using (role <> 'owner' and (public.has_album_role(album_id, 'owner') or user_id = auth.uid()));

-- media
create policy "media: members read" on public.media for select to authenticated
  using (public.has_album_role(album_id, 'viewer'));
create policy "media: editors add" on public.media for insert to authenticated
  with check (public.has_album_role(album_id, 'editor') and uploader_id = auth.uid());
create policy "media: editors edit" on public.media for update to authenticated
  using (public.has_album_role(album_id, 'editor')) with check (public.has_album_role(album_id, 'editor'));
create policy "media: uploader or owner deletes" on public.media for delete to authenticated
  using (uploader_id = auth.uid() or public.has_album_role(album_id, 'owner'));

-- invites: the owner manages them. Invitees accept through accept_invite().
create policy "invites: owner manages" on public.album_invites for all to authenticated
  using (public.has_album_role(album_id, 'owner'))
  with check (public.has_album_role(album_id, 'owner') and created_by = auth.uid());

-- share links: editors create and see them; the creator or the owner revokes.
create policy "links: editors read" on public.share_links for select to authenticated
  using (public.has_album_role(album_id, 'editor'));
create policy "links: editors create" on public.share_links for insert to authenticated
  with check (public.has_album_role(album_id, 'editor') and created_by = auth.uid());
create policy "links: creator or owner updates" on public.share_links for update to authenticated
  using (created_by = auth.uid() or public.has_album_role(album_id, 'owner'))
  with check (public.has_album_role(album_id, 'editor'));
create policy "links: creator or owner deletes" on public.share_links for delete to authenticated
  using (created_by = auth.uid() or public.has_album_role(album_id, 'owner'));

-- ---------------------------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------------------------

-- Invitations waiting for the signed-in user's email.
create function public.my_pending_invites()
returns table (token text, album_id uuid, album_title text, role public.album_role, invited_by_name text, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.token, i.album_id, a.title, i.role, p.display_name, i.expires_at
  from public.album_invites i
  join public.albums a on a.id = i.album_id
  left join public.profiles p on p.id = i.created_by
  where lower(i.email) = lower(auth.jwt() ->> 'email')
    and i.accepted_at is null and i.expires_at > now()
$$;

-- Accept an invitation addressed to the signed-in user's email. Returns the album id.
create function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.album_invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.album_invites
   where token = p_token and accepted_at is null and expires_at > now()
   for update;
  if not found then raise exception 'invite not found or expired'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'this invite is for a different email';
  end if;
  insert into public.album_members (album_id, user_id, role, invited_by)
  values (inv.album_id, auth.uid(), inv.role, inv.created_by)
  on conflict (album_id, user_id) do update
    set role = greatest(public.album_members.role, excluded.role);
  update public.album_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.album_id;
end;
$$;

-- What a share link shows. Callable without an account; returns nothing for a bad, expired or
-- revoked token. With hide_home, items within the album owner's home radius lose their location.
-- File paths come back for the shared-album edge function to sign; the bucket itself stays private.
create function public.get_shared_album(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  link public.share_links;
  alb public.albums;
  s public.user_settings;
begin
  select * into link from public.share_links
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  select * into alb from public.albums where id = link.album_id;
  select * into s from public.user_settings where user_id = alb.owner_id;

  return jsonb_build_object(
    'album', jsonb_build_object('id', alb.id, 'title', alb.title, 'description', alb.description),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'taken_at', m.taken_at, 'caption', m.caption, 'story', m.story,
        'width', m.width, 'height', m.height, 'duration_s', m.duration_s,
        'path_display', m.path_display, 'path_thumb', m.path_thumb, 'path_video', m.path_video,
        'lat', case when hidden then null else m.lat end,
        'lng', case when hidden then null else m.lng end,
        'place', case when hidden then null else m.place end
      ) order by m.taken_at nulls last, m.created_at)
      from (
        select m.*,
          link.hide_home and s.home_lat is not null and m.lat is not null and
          -- equirectangular distance in metres: plenty for a few hundred metres
          sqrt(power((m.lat - s.home_lat) * 110540, 2) +
               power((m.lng - s.home_lng) * 111320 * cos(radians(s.home_lat)), 2)) < s.home_radius_m as hidden
        from public.media m where m.album_id = link.album_id
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

-- Storage used by the signed-in user's uploads (for plan limits).
create view public.my_storage_usage with (security_invoker = true) as
  select count(*)::bigint as items, coalesce(sum(size_bytes), 0)::bigint as bytes
  from public.media where uploader_id = auth.uid();

-- Who may call what.
revoke all on function public.get_shared_album(text) from public;
grant execute on function public.get_shared_album(text) to anon, authenticated;
revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;
revoke all on function public.my_pending_invites() from public;
grant execute on function public.my_pending_invites() to authenticated;
grant execute on function public.has_album_role(uuid, public.album_role) to authenticated;
grant execute on function public.album_role_of(uuid) to authenticated;
grant select on public.my_storage_usage to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Storage: one private bucket, files under <album_id>/<media_id>/<file>
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 2147483648, -- 2 GB per file (long videos)
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create policy "media files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.has_album_role(public.try_uuid((storage.foldername(name))[1]), 'viewer'));
create policy "media files: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.has_album_role(public.try_uuid((storage.foldername(name))[1]), 'editor'));
create policy "media files: editors replace" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.has_album_role(public.try_uuid((storage.foldername(name))[1]), 'editor'));
create policy "media files: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.has_album_role(public.try_uuid((storage.foldername(name))[1]), 'editor'));
