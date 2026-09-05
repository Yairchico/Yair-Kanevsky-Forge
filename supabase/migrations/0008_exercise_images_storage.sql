-- A public Storage bucket for exercise images the trainer uploads directly
-- (an alternative to pasting an external image URL — see the exercise
-- library's image editor). Public read (images need to load in the app
-- with no auth headers); only the trainer can write to it.

insert into storage.buckets (id, name, public)
values ('exercise-images', 'exercise-images', true)
on conflict (id) do nothing;

drop policy if exists "public reads exercise-images" on storage.objects;
create policy "public reads exercise-images" on storage.objects
  for select using (bucket_id = 'exercise-images');

drop policy if exists "trainer manages exercise-images" on storage.objects;
create policy "trainer manages exercise-images" on storage.objects
  for all
  using (bucket_id = 'exercise-images' and public.is_trainer())
  with check (bucket_id = 'exercise-images' and public.is_trainer());
