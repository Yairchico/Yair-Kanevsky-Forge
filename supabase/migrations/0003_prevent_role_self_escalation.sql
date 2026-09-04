-- Security fix: the "trainee updates own profile" policy from migration
-- 0001 only checks `id = auth.uid()` — it does not restrict which
-- columns a trainee can change. That means a trainee could currently
-- call `supabase.from('profiles').update({ role: 'trainer' }).eq('id', myId)`
-- from the browser and promote themselves. RLS policies can't do
-- column-level restrictions directly, so this closes it with a trigger.

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- The service-role key (admin client) bypasses this entirely.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Anyone changing a profile's role must themselves already be the
  -- trainer (matches the "trainer manages profiles" policy's intent).
  -- is_trainer() reads the CURRENT (pre-update) row for auth.uid(), so a
  -- trainee updating their own row here still reads role='trainee'.
  if new.role is distinct from old.role and not public.is_trainer() then
    raise exception 'Only the trainer can change a profile''s role';
  end if;

  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_role_self_escalation();
