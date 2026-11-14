-- Permanent exercise notes + exercise videos (planning/PLAN.md, features 3-4).
--
-- Permanent note: nothing new to store. exercises.instructions (there since
-- migration 0001, until now only settable when an exercise was created) IS
-- the note that follows an exercise into every program; the app now lets
-- the trainer edit it. The per-program note stays where it always was
-- (workout_exercises.instructions) and is shown in addition to it, not
-- instead of it. The one new thing is an opt-out for the rare program where
-- the permanent note doesn't fit:
--
--   workout_exercises.hide_library_note
--
-- Video: a link (YouTube / Vimeo / a direct video file), validated and
-- turned into an embeddable player by src/lib/video.ts. Only the link is
-- stored — no upload, no storage bucket (that is a possible later phase).
--
--   exercises.video_url
--
-- Purely additive and safely re-runnable; the previously deployed code
-- ignores both columns.

alter table public.workout_exercises
  add column if not exists hide_library_note boolean not null default false;

alter table public.exercises
  add column if not exists video_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exercises_video_url_https'
  ) then
    -- The app validates the host and builds the player URL itself; this is
    -- only the backstop that keeps anything that isn't a plain https link
    -- (javascript:, data:, http:) out of the column, whoever writes it.
    alter table public.exercises
      add constraint exercises_video_url_https
      check (video_url is null or (video_url ~* '^https://[^[:space:]]+$' and char_length(video_url) <= 500));
  end if;
end $$;
