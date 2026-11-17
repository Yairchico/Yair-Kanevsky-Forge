-- Tiny test helpers (session-local). expect(label, sql, want): want is 'DENIED', 'ROWS:n' or 'OK' (any success).
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claim.role', case when uid = '' then '' else 'authenticated' end, false);
end $$;
create or replace function pg_temp.expect(label text, stmt text, want text) returns text language plpgsql as $$
declare n bigint; got text;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    got := 'ROWS:' || n;
  exception when others then
    got := 'DENIED';
    if want <> 'DENIED' then got := 'DENIED(' || sqlstate || ' ' || sqlerrm || ')'; end if;
  end;
  if got = want or (want = 'OK' and got like 'ROWS:%') then
    return 'PASS  ' || label;
  end if;
  return 'FAIL  ' || label || '  → got ' || got || ', want ' || want;
end $$;
create or replace function pg_temp.eq(label text, got text, want text) returns text language sql as $$
  select case when got is not distinct from want then 'PASS  ' || label else 'FAIL  ' || label || '  → got ' || coalesce(got,'<null>') || ', want ' || coalesce(want,'<null>') end
$$;
