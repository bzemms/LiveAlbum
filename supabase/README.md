# LiveAlbum backend (Supabase)

Accounts, private storage and sharing. The site stays a static app on Vercel; Supabase holds
users, albums, media rows and the files.

## What is here

| Path | What it is |
|---|---|
| `migrations/20261126000000_albums.sql` | Tables, row-level security, storage bucket and policies, and the functions the app calls |
| `tests/rls_test.sql` | 43 access-rule checks with an owner, an invited family member, a stranger and an anonymous visitor |
| `functions/shared-album/` | Edge function behind view-only share links: returns the album and short-lived signed file URLs |

## The rule

You see an album, its members, its media and its files only if you are a member of that album.

| Role | Can |
|---|---|
| viewer | see the album |
| editor | also add media, edit captions and places, create share links |
| owner | also invite and remove members, change roles, delete the album |

- Files live in one private bucket, `media`, at `<album_id>/<media_id>/<file>`, and follow the same rule.
- Invites go to an email address and work only for the account signed in with that address, once.
- Share links work without an account. They go through `get_shared_album`, which hides the location of
  anything taken within the owner's home radius (`user_settings.home_*`), and the edge function signs
  file URLs for one hour. Links can expire or be revoked.
- Each user's home location sits in `user_settings`, readable only by that user, never by album mates.

## Setting up a project

1. Create a project at supabase.com (region: Frankfurt, closest to Israel).
2. SQL editor → paste and run `migrations/20261126000000_albums.sql`
   (or with the CLI: `supabase link` then `supabase db push`).
3. Authentication → Providers: Email is on by default (magic link). Google and Apple can follow.
4. Authentication → URL configuration: add `https://live-album-mu.vercel.app` (and `http://localhost:5173`
   for development) to the redirect URLs.
5. Deploy the share-link function: `supabase functions deploy shared-album --no-verify-jwt`.
6. The site needs only the project URL and the **anon** key. Never put the `service_role` key in the site.

## Running the access-rule tests

The whole test runs in one transaction that is rolled back, so it leaves no users or albums behind.

- **Supabase SQL editor:** paste `tests/rls_test.sql` and Run. The result is `ALL RLS TESTS PASSED`,
  or an error naming the first check that failed.
- **psql:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql`
- **Plain Postgres** (no Supabase): first create the small stand-ins for `auth` and `storage`
  described at the top of the test file.
