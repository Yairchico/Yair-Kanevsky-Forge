-- Security hardening. Found in a full review of every RLS policy, trigger
-- and Server Action (2026-11-14); none of it depends on new app code, so
-- this migration can (and should) be run right away, even while the
-- previously deployed code is still live.
--
-- 1. PRIVILEGE ESCALATION — a trainee could make themselves a read-only
--    superadmin. Migration 0001's "trainee updates own profile" policy lets
--    a trainee UPDATE any column of their own profiles row; migration 0003's
--    trigger only guards `role`. Migration 0011 then added
--    `is_superadmin`, unguarded — so
--      supabase.from('profiles').update({ is_superadmin: true }).eq('id', me)
--    from a trainee's own browser session succeeded, and granted SELECT on
--    every trainee's profile (name, email, phone), program and workout
--    history. (Verified against a local database before writing this.)
--    Fix: the trigger now protects every privilege/identity column, and the
--    trainee UPDATE policy is removed outright (nothing in the app updates
--    a profile as a trainee).
--
-- 2. PRIVILEGE ESCALATION AT SIGN-UP — handle_new_user() copied `role`
--    straight from the new auth user's raw_user_meta_data, which is
--    whatever the caller passes to supabase.auth.signUp({ options: { data }
--    }). If public sign-ups are enabled on the Supabase project (the
--    default), anyone holding the public anon key could register with
--    { role: 'trainer' } and become a second trainer with full read/write
--    access. Fix: metadata may only produce a trainer while no trainer
--    exists yet (the first-run setup in the README); afterwards every new
--    account is a trainee. Public sign-ups should ALSO be switched off in
--    the Supabase dashboard (Authentication → Sign In / Providers →
--    "Allow new users to sign up") — see README.
--
-- 3. Performance tables (workout_logs, workout_completions,
--    workout_exercise_completions): a trainee's "for all" policy only
--    checked trainee_id = auth.uid(), so a trainee could write rows against
--    ANY workout/exercise id — another trainee's, or one in an unpublished
--    or deleted program. Same rule set_logs already got in migration 0013:
--    writes only against the trainee's own published, non-deleted program.
--
-- 4. Integrity: whoever writes a performance row (trainee now, the trainer
--    too once the trainer-led session mode lands), its trainee_id must be
--    the trainee the program actually belongs to. Enforced by a trigger so
--    it holds for every writer, not just through RLS.
--
-- 5. The read-only superadmin had no SELECT policy on
--    workout_exercise_completions, so their view always showed "0 done".
--
-- Safely re-runnable (create or replace / drop ... if exists throughout).

-- ---------------------------------------------------------------------------
-- 1. profiles: privilege and identity columns
-- ---------------------------------------------------------------------------

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Account management happens outside the app's own sessions: the
  -- service-role key (admin client), or the database dashboard / SQL editor
  -- (a direct connection carries no JWT at all, so auth.role() is null).
  if auth.role() is null or auth.role() = 'service_role' then
    return new;
  end if;

  -- From an app session, nobody changes these — not even the trainer.
  -- There is exactly one trainer by design; promoting a second one, or the
  -- trainer demoting themselves, both leave the app in a broken state.
  if new.id is distinct from old.id then
    raise exception 'A profile''s id cannot be changed';
  end if;
  if new.role is distinct from old.role then
    raise exception 'A profile''s role can only be changed from the database dashboard';
  end if;
  if new.is_superadmin is distinct from old.is_superadmin then
    raise exception 'is_superadmin can only be changed from the database dashboard';
  end if;

  -- Identity fields are the trainer's to manage (the trainee edit form).
  if not public.is_trainer() and (
    new.username is distinct from old.username
    or new.email is distinct from old.email
    or new.status is distinct from old.status
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Only the trainer can change these profile fields';
  end if;

  return new;
end;
$$;

-- The trigger itself exists since migration 0003; re-create it so this file
-- is self-contained on a database where that one was skipped.
drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_role_self_escalation();

-- Nothing in the app updates a profile from a trainee's session. (If a
-- "trainee edits own phone" feature is ever wanted, add a narrow policy or
-- RPC for exactly those columns rather than restoring this one.)
drop policy if exists "trainee updates own profile" on public.profiles;

-- ---------------------------------------------------------------------------
-- 2. Sign-up: never trust `role` from user-supplied metadata
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role public.user_role := 'trainee';
begin
  -- First-run bootstrap only (README: the trainer account is created with
  -- role = 'trainer' in its metadata). Once a trainer exists, metadata can
  -- no longer mint another one.
  if (new.raw_user_meta_data ->> 'role') = 'trainer'
     and not exists (select 1 from public.profiles where role = 'trainer') then
    v_role := 'trainer';
  end if;

  insert into public.profiles (id, role, full_name, phone, email, username)
  values (
    new.id,
    v_role,
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

-- ---------------------------------------------------------------------------
-- 3. Performance tables: a trainee writes only against their own published,
--    non-deleted program
-- ---------------------------------------------------------------------------

-- workout_logs --------------------------------------------------------------
drop policy if exists "trainee manages own workout_logs" on public.workout_logs;

drop policy if exists "trainee reads own workout_logs" on public.workout_logs;
create policy "trainee reads own workout_logs" on public.workout_logs
  for select using (trainee_id = auth.uid());

drop policy if exists "trainee inserts own workout_logs" on public.workout_logs;
create policy "trainee inserts own workout_logs" on public.workout_logs
  for insert with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = workout_logs.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee updates own workout_logs" on public.workout_logs;
create policy "trainee updates own workout_logs" on public.workout_logs
  for update using (trainee_id = auth.uid()) with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = workout_logs.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee deletes own workout_logs" on public.workout_logs;
create policy "trainee deletes own workout_logs" on public.workout_logs
  for delete using (trainee_id = auth.uid());

-- workout_exercise_completions ----------------------------------------------
drop policy if exists "trainee manages own workout_exercise_completions"
  on public.workout_exercise_completions;

drop policy if exists "trainee reads own workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "trainee reads own workout_exercise_completions"
  on public.workout_exercise_completions
  for select using (trainee_id = auth.uid());

drop policy if exists "trainee inserts own workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "trainee inserts own workout_exercise_completions"
  on public.workout_exercise_completions
  for insert with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = workout_exercise_completions.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee updates own workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "trainee updates own workout_exercise_completions"
  on public.workout_exercise_completions
  for update using (trainee_id = auth.uid()) with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = workout_exercise_completions.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee deletes own workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "trainee deletes own workout_exercise_completions"
  on public.workout_exercise_completions
  for delete using (trainee_id = auth.uid());

-- workout_completions --------------------------------------------------------
drop policy if exists "trainee manages own workout_completions" on public.workout_completions;

drop policy if exists "trainee reads own workout_completions" on public.workout_completions;
create policy "trainee reads own workout_completions" on public.workout_completions
  for select using (trainee_id = auth.uid());

drop policy if exists "trainee inserts own workout_completions" on public.workout_completions;
create policy "trainee inserts own workout_completions" on public.workout_completions
  for insert with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workouts w
      join public.programs p on p.id = w.program_id
      where w.id = workout_completions.workout_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee updates own workout_completions" on public.workout_completions;
create policy "trainee updates own workout_completions" on public.workout_completions
  for update using (trainee_id = auth.uid()) with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workouts w
      join public.programs p on p.id = w.program_id
      where w.id = workout_completions.workout_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee deletes own workout_completions" on public.workout_completions;
create policy "trainee deletes own workout_completions" on public.workout_completions
  for delete using (trainee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Integrity: a performance row's trainee_id is the program's trainee
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER: it has to see the owning program even when the writer
-- couldn't (RLS) — that is exactly the case it exists to reject.
create or replace function public.enforce_performance_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if tg_table_name = 'workout_completions' then
    select p.trainee_id into v_owner
    from public.workouts w
    join public.programs p on p.id = w.program_id
    where w.id = new.workout_id;
  else
    select p.trainee_id into v_owner
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    join public.programs p on p.id = w.program_id
    where we.id = new.workout_exercise_id;
  end if;

  -- A missing parent is the foreign key's job to report (23503).
  if v_owner is not null and v_owner is distinct from new.trainee_id then
    raise exception 'This workout does not belong to that trainee'
      using errcode = '23514';
  end if;

  if tg_table_name = 'set_logs' then
    -- A link to a planned set is only kept when it really is this exercise's
    -- set at this index.
    if new.workout_exercise_set_id is not null and not exists (
      select 1 from public.workout_exercise_sets s
      where s.id = new.workout_exercise_set_id
        and s.workout_exercise_id = new.workout_exercise_id
        and s.set_index = new.set_index
    ) then
      new.workout_exercise_set_id := null;
    end if;

    -- Who logged it is a fact, not something the client gets to claim.
    -- (Direct SQL — e.g. migration 0013's 'legacy' backfill — is left alone.)
    if auth.role() = 'authenticated' then
      new.logged_by := auth.uid();
      new.source := case when auth.uid() = new.trainee_id then 'trainee' else 'trainer_session' end;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workout_logs_enforce_owner on public.workout_logs;
create trigger workout_logs_enforce_owner
  before insert or update on public.workout_logs
  for each row execute procedure public.enforce_performance_owner();

drop trigger if exists workout_completions_enforce_owner on public.workout_completions;
create trigger workout_completions_enforce_owner
  before insert or update on public.workout_completions
  for each row execute procedure public.enforce_performance_owner();

drop trigger if exists workout_exercise_completions_enforce_owner
  on public.workout_exercise_completions;
create trigger workout_exercise_completions_enforce_owner
  before insert or update on public.workout_exercise_completions
  for each row execute procedure public.enforce_performance_owner();

drop trigger if exists set_logs_enforce_owner on public.set_logs;
create trigger set_logs_enforce_owner
  before insert or update on public.set_logs
  for each row execute procedure public.enforce_performance_owner();

-- ---------------------------------------------------------------------------
-- 5. Superadmin: the one read policy migration 0011 missed
-- ---------------------------------------------------------------------------

drop policy if exists "superadmin reads all workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "superadmin reads all workout_exercise_completions"
  on public.workout_exercise_completions
  for select using (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- Trigger functions are not meant to be called over the API.
-- ---------------------------------------------------------------------------

revoke execute on function public.enforce_performance_owner() from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
