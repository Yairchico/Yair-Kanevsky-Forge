-- Adds profiles.email (denormalized from auth.users) so the trainer UI can
-- show a trainee's email without an extra admin API call, and makes
-- exercises.name unique so supabase/seed.sql can be re-run safely.

alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null;

alter table public.exercises add constraint exercises_name_key unique (name);

-- Re-create the trigger function to also populate phone + email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, email)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'trainee'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'phone',
    new.email
  );
  return new;
end;
$$;
