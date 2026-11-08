begin;

create table public.qa_questions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  question text not null check (char_length(question) between 1 and 1000),
  reply text check (char_length(reply) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'published' and published_at is not null and reply is not null)
    or (status <> 'published' and published_at is null))
);

create index qa_questions_created_at_idx on public.qa_questions (created_at desc);
create index qa_questions_published_at_idx on public.qa_questions (published_at desc, id desc)
  where status = 'published';

alter table public.qa_questions enable row level security;
revoke all on table public.qa_questions from public, anon, authenticated, service_role;
grant select on table public.qa_questions to service_role;

create function public.qa_submit(p_request_id uuid, p_question text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted_at timestamptz;
begin
  if p_request_id is null or p_question is null or char_length(p_question) not between 1 and 1000 then
    return 'invalid_input';
  end if;

  -- Serialize admission for this inbox. The request ID check and rolling
  -- quota are evaluated under the same transaction lock as the insert.
  perform pg_advisory_xact_lock(195179, 1);
  if exists (select 1 from public.qa_questions where request_id = p_request_id) then
    return 'duplicate';
  end if;

  submitted_at := clock_timestamp();
  if (select count(*) from public.qa_questions where created_at >= submitted_at - interval '10 minutes') >= 30 then
    return 'rate_limited';
  end if;

  insert into public.qa_questions (request_id, question, created_at, updated_at)
  values (p_request_id, p_question, submitted_at, submitted_at);
  return 'inserted';
end;
$$;

create function public.qa_moderate(
  p_id uuid,
  p_action text,
  p_reply text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.qa_questions%rowtype;
begin
  if p_id is null or p_expected_updated_at is null then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select * into item from public.qa_questions where id = p_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if item.updated_at <> p_expected_updated_at then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  case p_action
    when 'publish' then
      if p_reply is null or char_length(p_reply) not between 1 and 2000 then
        return jsonb_build_object('outcome', 'invalid_input');
      end if;
      if item.status not in ('pending', 'published') then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      item.status := 'published';
      item.reply := p_reply;
      item.published_at := coalesce(item.published_at, clock_timestamp());
    when 'unpublish' then
      if item.status <> 'published' then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      item.status := 'pending';
      item.published_at := null;
    when 'archive' then
      if item.status <> 'pending' then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      item.status := 'archived';
    when 'restore' then
      if item.status <> 'archived' then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      item.status := 'pending';
    else
      return jsonb_build_object('outcome', 'invalid_input');
  end case;

  update public.qa_questions
  set status = item.status,
      reply = item.reply,
      published_at = item.published_at,
      updated_at = greatest(clock_timestamp(), item.updated_at + interval '1 microsecond')
  where id = item.id
  returning * into item;

  return jsonb_build_object('outcome', 'updated', 'question', to_jsonb(item) - 'request_id');
end;
$$;

revoke all on function public.qa_submit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.qa_moderate(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.qa_submit(uuid, text) to service_role;
grant execute on function public.qa_moderate(uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
