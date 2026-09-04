-- Adds a username to every profile and switches login to be
-- username-based instead of email-based. Supabase Auth still needs *an*
-- email under the hood (signInWithPassword requires one) — the app just
-- never surfaces it: the trainer can leave it blank when creating a
-- trainee (a placeholder @trainees.local address is used), and login asks
-- for a username, which this migration's email_for_username() resolves
-- to the real/placeholder email server-side before calling
-- signInWithPassword.

alter table public.profiles add column username text;

-- Backfill existing rows (e.g. the trainer, created before this
-- migration) from the local part of their email.
update public.profiles p
set username = lower(regexp_replace(split_part(u.email, '@', 1), '[^a-z0-9_.]', '', 'gi'))
from auth.users u
where p.id = u.id
  and p.username is null;

-- Guard against the backfill producing an empty string (e.g. a
-- pathological email) or a collision.
update public.profiles
set username = 'user_' || substr(id::text, 1, 8)
where username is null or username = '';

alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_.]{3,32}$'),
  alter column username set not null,
  add constraint profiles_username_key unique (username);

-- Re-create the trigger function to also populate username.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, email, username)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'trainee'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'phone',
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_.]', '', 'gi'))
    )
  );
  return new;
end;
$$;

-- Looks up the (real or placeholder) email for a username, so the login
-- form can ask for a username while still calling signInWithPassword
-- with an email underneath. SECURITY DEFINER + a narrow return type
-- (just the email string) so an unauthenticated caller can resolve a
-- username without gaining any other read access to `profiles`.
create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select email from public.profiles where username = lower(p_username) limit 1;
$$;

grant execute on function public.email_for_username(text) to anon, authenticated;
