-- Workouts move from a flat "up to 10 per program" list to a real day of
-- the week (Sunday-Saturday, matching src/lib/week.ts) with up to 2
-- workouts per day. The trainer now picks a day before creating a
-- workout — see the program builder's day-picker.
--
-- order_index changes meaning: it's now the order *within that day* (0 or
-- 1), not a global position — the global "אימון N" numbering is derived
-- at display time by sorting (day_of_week, order_index), not stored.

alter table public.workouts add column if not exists day_of_week smallint;

-- Backfill: this is pre-launch test data, so spreading existing workouts
-- across days two-at-a-time (in their current order) is a reasonable
-- default that immediately satisfies the new max-2-per-day rule.
with ranked as (
  select id, row_number() over (partition by program_id order by order_index, id) - 1 as rn
  from public.workouts
  where day_of_week is null
)
update public.workouts w
set day_of_week = least(ranked.rn / 2, 6),
    order_index = ranked.rn % 2
from ranked
where w.id = ranked.id;

alter table public.workouts alter column day_of_week set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workouts_day_of_week_range'
  ) then
    alter table public.workouts
      add constraint workouts_day_of_week_range check (day_of_week between 0 and 6);
  end if;
end $$;

-- Replace the old "max 10 per program" rule with "max 2 per day".
drop trigger if exists workouts_max_10_per_program on public.workouts;
drop function if exists public.enforce_max_workouts_per_program();

create or replace function public.enforce_max_workouts_per_day()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*) from public.workouts
    where program_id = new.program_id
      and day_of_week = new.day_of_week
      and id is distinct from new.id
  ) >= 2 then
    raise exception 'ניתן ליצור עד 2 אימונים ביום';
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_max_2_per_day on public.workouts;
create trigger workouts_max_2_per_day
  before insert or update of day_of_week on public.workouts
  for each row execute procedure public.enforce_max_workouts_per_day();
