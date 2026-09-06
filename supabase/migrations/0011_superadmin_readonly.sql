-- A read-only "superadmin" oversight role: can see everything (every
-- trainee, every program regardless of status, all workout history) but
-- can never write anything — not even by mistake, and not by editing the
-- trainer's own data. Deliberately NOT a third `user_role` enum value:
-- `role` stays exactly {trainer, trainee} and continues to gate
-- "for all" (read/write) access via is_trainer(); is_superadmin is an
-- orthogonal boolean flag that only ever grants SELECT, on top of
-- whatever `role` already grants (a superadmin's own profile.role stays
-- 'trainee', so is_trainer() is false for them and every existing "for
-- all" trainer policy still denies them write access).
--
-- Created manually per-account, same as the sole trainer account is
-- today (see README) — there is no in-app "invite" flow for this.

alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

create function public.is_superadmin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_superadmin = true
  );
$$;

-- profiles: a superadmin can already read their own row (existing "trainer
-- reads all profiles" policy's `id = auth.uid()` clause) — this adds
-- reading everyone else's too. No write policy is added anywhere below:
-- that absence is the actual enforcement, not just app-level UI hiding.
create policy "superadmin reads all profiles" on public.profiles
  for select using (public.is_superadmin());

create policy "superadmin reads all programs" on public.programs
  for select using (public.is_superadmin());

create policy "superadmin reads all workouts" on public.workouts
  for select using (public.is_superadmin());

create policy "superadmin reads all workout_exercises" on public.workout_exercises
  for select using (public.is_superadmin());

create policy "superadmin reads all workout_logs" on public.workout_logs
  for select using (public.is_superadmin());

create policy "superadmin reads all workout_completions" on public.workout_completions
  for select using (public.is_superadmin());

-- exercises already has "authenticated reads exercises" (any signed-in
-- user) — nothing to add there.
