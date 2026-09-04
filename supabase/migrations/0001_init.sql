-- Initial schema for the trainer/trainee fitness app.
-- Single-trainer MVP: exactly one profile has role='trainer' (the superadmin
-- coach); everyone else is role='trainee'. See PLAN.md section 0 for why
-- there is no organizations/multi-tenant layer yet.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('trainer', 'trainee');
create type public.program_status as enum ('draft', 'published');

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'trainee',
  full_name text not null,
  phone text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users id. role=''trainer'' identifies the single coach (superadmin).';

-- Auto-create a profile row whenever a new auth user is created.
-- The trainer account should be created with raw_user_meta_data ->> 'role' = 'trainer'
-- (see README for the seed steps); everyone else defaults to 'trainee'.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'trainee'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- exercises — shared library, managed by the trainer
-- ---------------------------------------------------------------------------

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text,
  equipment text,
  instructions text,
  media_url text,
  is_custom boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index exercises_name_idx on public.exercises using gin (to_tsvector('simple', name));

-- ---------------------------------------------------------------------------
-- programs — a trainee's weekly training plan
-- ---------------------------------------------------------------------------

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  status public.program_status not null default 'draft',
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index programs_trainee_id_idx on public.programs (trainee_id);

-- ---------------------------------------------------------------------------
-- program_days — days within a program (e.g. "יום א'")
-- ---------------------------------------------------------------------------

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  day_index integer not null check (day_index between 0 and 6),
  label text,
  unique (program_id, day_index)
);

-- ---------------------------------------------------------------------------
-- workouts — a workout within a program day
-- ---------------------------------------------------------------------------

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days (id) on delete cascade,
  order_index integer not null default 0,
  title text,
  notes text
);

-- ---------------------------------------------------------------------------
-- workout_exercises — the flow-builder rows (sets/reps/weight/RPE/rest/notes)
-- ---------------------------------------------------------------------------

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  order_index integer not null default 0,
  sets integer,
  reps text,
  weight text,
  rpe numeric(3, 1),
  rest_seconds integer,
  instructions text
);

create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);

-- ---------------------------------------------------------------------------
-- workout_logs — what the trainee actually did
-- ---------------------------------------------------------------------------

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  performed_at timestamptz not null default now(),
  actual_sets jsonb,
  rpe_actual numeric(3, 1),
  notes text
);

create index workout_logs_trainee_id_idx on public.workout_logs (trainee_id);
create index workout_logs_performed_at_idx on public.workout_logs (performed_at);

-- ---------------------------------------------------------------------------
-- workout_completions — marking a whole workout as done
-- ---------------------------------------------------------------------------

create table public.workout_completions (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (workout_id, trainee_id)
);

create index workout_completions_trainee_id_idx on public.workout_completions (trainee_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.programs enable row level security;
alter table public.program_days enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_completions enable row level security;

-- Helper: is the current user the (single) trainer?
create function public.is_trainer()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'trainer'
  );
$$;

-- profiles: trainer sees everyone; trainees see only themselves.
create policy "trainer reads all profiles" on public.profiles
  for select using (public.is_trainer() or id = auth.uid());
create policy "trainer manages profiles" on public.profiles
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee updates own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- exercises: everyone signed in can read; only the trainer writes.
create policy "authenticated reads exercises" on public.exercises
  for select using (auth.uid() is not null);
create policy "trainer manages exercises" on public.exercises
  for all using (public.is_trainer()) with check (public.is_trainer());

-- programs: trainer full access; trainee reads only their own published programs.
create policy "trainer manages programs" on public.programs
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published programs" on public.programs
  for select using (trainee_id = auth.uid() and status = 'published');

-- program_days / workouts / workout_exercises: same shape, scoped via the
-- owning program's trainee_id + status.
create policy "trainer manages program_days" on public.program_days
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published program_days" on public.program_days
  for select using (
    exists (
      select 1 from public.programs p
      where p.id = program_days.program_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
    )
  );

create policy "trainer manages workouts" on public.workouts
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published workouts" on public.workouts
  for select using (
    exists (
      select 1 from public.program_days pd
      join public.programs p on p.id = pd.program_id
      where pd.id = workouts.program_day_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
    )
  );

create policy "trainer manages workout_exercises" on public.workout_exercises
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published workout_exercises" on public.workout_exercises
  for select using (
    exists (
      select 1 from public.workouts w
      join public.program_days pd on pd.id = w.program_day_id
      join public.programs p on p.id = pd.program_id
      where w.id = workout_exercises.workout_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
    )
  );

-- workout_logs / workout_completions: trainer reads all, trainee reads/writes own.
create policy "trainer reads all workout_logs" on public.workout_logs
  for select using (public.is_trainer());
create policy "trainee manages own workout_logs" on public.workout_logs
  for all using (trainee_id = auth.uid()) with check (trainee_id = auth.uid());

create policy "trainer reads all workout_completions" on public.workout_completions
  for select using (public.is_trainer());
create policy "trainee manages own workout_completions" on public.workout_completions
  for all using (trainee_id = auth.uid()) with check (trainee_id = auth.uid());
