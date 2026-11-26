-- Access-rule tests for the LiveAlbum schema. Run against a database with the migration applied
-- (in Supabase: the SQL editor of a scratch project, or `supabase test db` after wrapping in pgTAP).
-- Each check raises an exception on failure; the script ends with "ALL RLS TESTS PASSED".
-- Outside Supabase, a plain Postgres needs stand-ins first: roles anon/authenticated, schema
-- `extensions` with pgcrypto, auth.users + auth.uid()/auth.jwt() reading request.jwt.claim(s),
-- and storage.buckets/storage.objects (RLS on) with storage.foldername().
-- Users: alice (album owner), bob (family member, invited), carol (a stranger), and anon.

-- Everything runs in one transaction that is rolled back at the end, so it can run in the Supabase
-- SQL editor against a real project without leaving test users or albums behind.
begin;
set local client_min_messages = notice;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- Rows changed by a statement (data-modifying CTEs can't sit inside a subquery).
create or replace function pg_temp.affected(q text) returns integer language plpgsql as $$
declare n integer;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;

-- Run the following statements as a given user (or anon when uid is null).
create or replace function pg_temp.as_user(uid uuid, email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'email', email)::text end, false);
  execute case when uid is null then 'set role anon' else 'set role authenticated' end;
end $$;

-- Accounts (as the service: like Supabase Auth creating users).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{}');
select pg_temp.ok((select count(*) from public.profiles) = 3, 'a profile is created for each new user');
select pg_temp.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'bob', 'display name falls back to the email name');

-- ---------------- Alice creates an album with two photos ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
insert into public.albums (id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Family event');
select pg_temp.ok((select role from public.album_members where album_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = auth.uid()) = 'owner', 'the creator becomes the owner');
insert into public.media (id, album_id, kind, path_display, path_thumb, lat, lng, location_source, size_bytes) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'photo', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000001/display.jpg', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000001/thumb.jpg', 32.0874, 34.8324, 'exif', 1000),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'photo', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000002/display.jpg', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000002/thumb.jpg', 31.7767, 35.2345, 'manual', 2000);
insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000001/display.jpg');
select pg_temp.ok((select count(*) from public.media) = 2, 'the owner sees her photos');
select pg_temp.ok((select bytes from public.my_storage_usage) = 3000, 'storage usage counts her uploads');
update public.user_settings set home_lat = 32.0875, home_lng = 34.8326, home_radius_m = 400 where user_id = auth.uid();

-- ---------------- Carol, a stranger, sees nothing and can do nothing ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c', 'carol@example.com');
select pg_temp.ok((select count(*) from public.albums) = 0, 'a stranger sees no albums');
select pg_temp.ok((select count(*) from public.media) = 0, 'a stranger sees no media');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'a stranger sees no files');
select pg_temp.ok((select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 0, 'a stranger cannot look up other people''s profiles');
select pg_temp.ok((select count(*) from public.user_settings) = 1, 'a stranger reads only her own settings (not Alice''s home)');
do $$ begin
  insert into public.media (album_id, kind, path_display, path_thumb) values ('aaaaaaaa-0000-0000-0000-000000000001', 'photo', 'x', 'y');
  raise exception 'FAILED: stranger inserted media';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot add media'; end $$;
do $$ begin
  insert into public.album_members (album_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'viewer');
  raise exception 'FAILED: stranger joined album';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot add herself to an album'; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('media', 'aaaaaaaa-0000-0000-0000-000000000001/evil/x.jpg');
  raise exception 'FAILED: stranger uploaded a file';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot upload into the album'; end $$;
do $$ begin
  insert into public.albums (title, owner_id) values ('spoof', '00000000-0000-0000-0000-00000000000a');
  raise exception 'FAILED: album created in someone else''s name';
exception when insufficient_privilege then raise notice 'ok: nobody can create an album in someone else''s name'; end $$;
select pg_temp.ok(pg_temp.affected($q$delete from public.media$q$) = 0, 'a stranger deletes nothing');

-- ---------------- Alice invites Bob ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
insert into public.album_invites (album_id, email, role, token) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Bob@Example.com', 'viewer', 'invite-token-for-bob-000000000001');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c', 'carol@example.com');
do $$ begin
  perform public.accept_invite('invite-token-for-bob-000000000001');
  raise exception 'FAILED: carol accepted bob''s invite';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: an invite only works for the invited email (%)', sqlerrm;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.ok((select count(*) from public.my_pending_invites()) = 1, 'bob sees his pending invite');
select pg_temp.ok(public.accept_invite('invite-token-for-bob-000000000001') = 'aaaaaaaa-0000-0000-0000-000000000001', 'bob accepts the invite');
select pg_temp.ok((select count(*) from public.albums) = 1 and (select count(*) from public.media) = 2, 'bob now sees the album and its photos');
select pg_temp.ok((select count(*) from storage.objects) = 1, 'bob can read the album''s files');
select pg_temp.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice', 'album mates see each other''s names');
select pg_temp.ok((select count(*) from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'album mates never see each other''s home');
do $$ begin
  insert into public.media (album_id, kind, path_display, path_thumb) values ('aaaaaaaa-0000-0000-0000-000000000001', 'photo', 'x', 'y');
  raise exception 'FAILED: viewer inserted media';
exception when insufficient_privilege then raise notice 'ok: a viewer cannot add media'; end $$;
select pg_temp.ok(pg_temp.affected($q$update public.album_members set role = 'owner' where user_id = auth.uid()$q$) = 0, 'a viewer cannot promote himself');
select pg_temp.ok(pg_temp.affected($q$delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000a'$q$) = 0, 'a viewer cannot remove the owner');
do $$ begin
  perform public.accept_invite('invite-token-for-bob-000000000001');
  raise exception 'FAILED: invite reused';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: an invite works only once';
end $$;

-- ---------------- Alice makes Bob an editor ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.ok(pg_temp.affected($q$update public.album_members set role = 'editor' where user_id = '00000000-0000-0000-0000-00000000000b'$q$) = 1, 'the owner promotes bob to editor');
do $$ begin
  update public.album_members set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000b';
  raise exception 'FAILED: second owner created';
exception when insufficient_privilege then raise notice 'ok: ownership cannot be handed out through a role change'; end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
insert into public.media (id, album_id, kind, path_display, path_thumb) values ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'photo', 'p/d.jpg', 'p/t.jpg');
select pg_temp.ok(true, 'an editor adds media');
select pg_temp.ok(pg_temp.affected($q$delete from public.media where id = '11111111-0000-0000-0000-000000000001'$q$) = 0, 'an editor cannot delete someone else''s photo');
select pg_temp.ok(pg_temp.affected($q$delete from public.media where id = '11111111-0000-0000-0000-000000000003'$q$) = 1, 'an editor deletes his own photo');
select pg_temp.affected($q$update public.albums set owner_id = auth.uid()$q$);
select pg_temp.ok((select owner_id from public.albums) = '00000000-0000-0000-0000-00000000000a', 'the album owner cannot be changed by an update');

-- ---------------- Share link for grandma (anonymous) ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
insert into public.share_links (album_id, token) values ('aaaaaaaa-0000-0000-0000-000000000001', 'share-token-for-grandma-0000000001');

select pg_temp.as_user(null, null);
select pg_temp.ok((select count(*) from public.albums) = 0, 'anonymous visitors cannot read tables directly');
select pg_temp.ok(public.get_shared_album('share-token-for-grandma-0000000001') -> 'album' ->> 'title' = 'Family event', 'a share link shows the album');
select pg_temp.ok(jsonb_array_length(public.get_shared_album('share-token-for-grandma-0000000001') -> 'items') = 2, 'a share link lists its photos');
select pg_temp.ok((select (i ->> 'lat') is null from jsonb_array_elements(public.get_shared_album('share-token-for-grandma-0000000001') -> 'items') i where i ->> 'id' = '11111111-0000-0000-0000-000000000001'), 'a photo taken at home loses its location on a share link');
select pg_temp.ok((select (i ->> 'lat')::float = 31.7767 from jsonb_array_elements(public.get_shared_album('share-token-for-grandma-0000000001') -> 'items') i where i ->> 'id' = '11111111-0000-0000-0000-000000000002'), 'a photo taken away from home keeps its location');
select pg_temp.ok(public.get_shared_album('wrong-token-0000000000000000000000') is null, 'a wrong token shows nothing');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
update public.share_links set revoked_at = now() where token = 'share-token-for-grandma-0000000001';
select pg_temp.as_user(null, null);
select pg_temp.ok(public.get_shared_album('share-token-for-grandma-0000000001') is null, 'a revoked link stops working');

-- ---------------- Bob leaves; Alice deletes the album ----------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.ok(pg_temp.affected($q$delete from public.album_members where user_id = auth.uid()$q$) = 1, 'a member can leave');
select pg_temp.ok((select count(*) from public.albums) = 0, 'after leaving, the album is gone for him');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.ok(pg_temp.affected($q$delete from public.album_members where user_id = auth.uid()$q$) = 0, 'the owner cannot leave her own album (she deletes it instead)');
delete from public.albums where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) from public.media) = 0, 'deleting an album deletes its media rows');

select 'ALL RLS TESTS PASSED' as result;
rollback;
