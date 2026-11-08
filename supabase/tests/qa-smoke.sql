-- Run the entire script in a fresh SQL Editor query as postgres after applying
-- the Q&A migration and before enabling public submissions. Test rows are rolled back.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  qa_table constant regclass := 'public.qa_questions'::regclass;
  submit_rpc constant regprocedure := 'public.qa_submit(uuid,text)'::regprocedure;
  moderate_rpc constant regprocedure := 'public.qa_moderate(uuid,text,text,timestamptz)'::regprocedure;
  original_request_id constant uuid := gen_random_uuid();
  filler_id uuid;
  actor name;
  original public.qa_questions%rowtype;
  item public.qa_questions%rowtype;
  step record;
  result jsonb;
  version_at timestamptz;
  first_published_at timestamptz;
begin
  if (select relrowsecurity from pg_catalog.pg_class where oid = qa_table) is distinct from true then
    raise exception 'Q&A table must have row-level security enabled';
  end if;
  foreach actor in array array['anon', 'authenticated']::name[] loop
    if has_table_privilege(actor, qa_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        or has_any_column_privilege(actor, qa_table, 'SELECT, INSERT, UPDATE, REFERENCES')
        or has_function_privilege(actor, submit_rpc, 'EXECUTE')
        or has_function_privilege(actor, moderate_rpc, 'EXECUTE') then
      raise exception 'Browser role % has direct Q&A access', actor;
    end if;
  end loop;
  if not has_schema_privilege('service_role', 'public', 'USAGE')
      or not has_table_privilege('service_role', qa_table, 'SELECT')
      or not has_function_privilege('service_role', submit_rpc, 'EXECUTE')
      or not has_function_privilege('service_role', moderate_rpc, 'EXECUTE') then
    raise exception 'Service role needs Q&A read and RPC permissions';
  end if;
  if has_table_privilege('service_role', qa_table, 'INSERT, UPDATE, DELETE, TRUNCATE')
      or has_any_column_privilege('service_role', qa_table, 'INSERT, UPDATE') then
    raise exception 'Service role writes must go through the Q&A RPCs';
  end if;

  if not pg_try_advisory_xact_lock(195179, 1) then
    raise exception 'Q&A submissions are active. Run this smoke check before opening the form';
  end if;
  if exists (select 1 from public.qa_questions) then
    raise exception 'Q&A smoke check requires an empty inbox before public enablement';
  end if;

  if public.qa_submit(original_request_id, 'Smoke question') is distinct from 'inserted' then
    raise exception 'First submission was not accepted';
  end if;
  for number in 2..30 loop
    filler_id := gen_random_uuid();
    if public.qa_submit(filler_id, 'Smoke quota filler') is distinct from 'inserted' then
      raise exception 'Submission % was rejected before reaching the cap', number;
    end if;
  end loop;
  update public.qa_questions set created_at = clock_timestamp() - interval '9 minutes'
  where qa_questions.request_id = filler_id;
  if public.qa_submit(gen_random_uuid(), 'Smoke over-cap question') is distinct from 'rate_limited' then
    raise exception 'Expected a cap of 30 submissions in the last 10 minutes';
  end if;
  if public.qa_submit(original_request_id, 'Smoke duplicate text') is distinct from 'duplicate'
      or (select count(*) from public.qa_questions) <> 30 then
    raise exception 'A replay at the cap must be acknowledged without inserting a row';
  end if;
  update public.qa_questions set created_at = clock_timestamp() - interval '10 minutes 1 second'
  where qa_questions.request_id = filler_id;
  if public.qa_submit(gen_random_uuid(), 'Smoke post-window question') is distinct from 'inserted' then
    raise exception 'A submission outside the 10-minute window must release capacity';
  end if;

  select * into strict original from public.qa_questions q where q.request_id = original_request_id;
  if original.question <> 'Smoke question' or original.status <> 'pending'
      or original.reply is not null or original.published_at is not null then
    raise exception 'Submission or replay changed the expected initial question';
  end if;
  version_at := original.updated_at;

  for step in
    select * from (values
      (1, 'publish', 'Smoke reply', 'published', 'Smoke reply'),
      (2, 'publish', 'Revised smoke reply', 'published', 'Revised smoke reply'),
      (3, 'unpublish', null, 'pending', 'Revised smoke reply'),
      (4, 'archive', null, 'archived', 'Revised smoke reply'),
      (5, 'restore', null, 'pending', 'Revised smoke reply')
    ) as steps(position, action, input_reply, expected_status, expected_reply)
    order by position
  loop
    result := public.qa_moderate(original.id, step.action, step.input_reply, version_at);
    if result->>'outcome' is distinct from 'updated' then
      raise exception 'Moderation step % failed: %', step.action, result->>'outcome';
    end if;
    select * into strict item from public.qa_questions where id = original.id;
    if item.status is distinct from step.expected_status or item.reply is distinct from step.expected_reply
        or item.created_at is distinct from original.created_at or item.updated_at <= version_at
        or result->'question' is distinct from (to_jsonb(item) - 'request_id') then
      raise exception 'Unexpected row or version after %', step.action;
    end if;
    if step.expected_status = 'published' then
      if item.published_at is null or item.published_at < item.created_at
          or (first_published_at is not null and item.published_at <> first_published_at) then
        raise exception 'Publishing must set a timestamp and editing must preserve it';
      end if;
      first_published_at := item.published_at;
    elsif item.published_at is not null then
      raise exception 'Unexpected publication timestamp after %', step.action;
    end if;
    version_at := item.updated_at;
  end loop;

  result := public.qa_moderate(original.id, 'archive', null, original.updated_at);
  if result->>'outcome' is distinct from 'conflict' then
    raise exception 'Expected a conflict when using the original version';
  end if;
  if not exists (select 1 from public.qa_questions where id = original.id and status = 'pending' and updated_at = version_at) then
    raise exception 'A stale update changed the restored question';
  end if;
  raise notice 'Q&A smoke checks passed. Rolling back test data.';
end;
$$;

rollback;
