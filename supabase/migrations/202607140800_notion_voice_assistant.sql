create table if not exists public.notion_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id text not null,
  workspace_name text not null,
  access_token_ciphertext text not null,
  bot_id text,
  owner_metadata jsonb not null default '{}'::jsonb,
  connection_status text not null default 'connected' check (connection_status in ('connected','disconnected','error')),
  last_successful_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notion_assistant_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_entry_source_id text,
  daily_entry_source_type text,
  daily_entry_date_property text,
  daily_entry_title_property text,
  map_object_id text,
  map_object_type text,
  exercise_section_block_id text,
  timezone text not null default 'Asia/Kolkata',
  confirmation_preference text not null default 'risk_based' check (confirmation_preference in ('risk_based','always')),
  voice_response_preference boolean not null default true,
  default_insertion_behavior text not null default 'match_existing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  input_type text not null check (input_type in ('voice','text')),
  original_transcript text not null check (char_length(original_transcript) <= 2000),
  normalized_intent jsonb not null default '{}'::jsonb,
  status text not null check (status in ('running','waiting_confirmation','completed','partial','failed','cancelled')),
  model text,
  usage jsonb not null default '{}'::jsonb,
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.assistant_actions (
  id uuid primary key,
  run_id uuid not null references public.assistant_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  target_object_id text,
  target_title text,
  target_url text,
  action_type text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('pending_confirmation','completed','partial','failed')),
  idempotency_key text,
  undo_payload jsonb not null default '{}'::jsonb,
  undo_status text not null default 'unavailable' check (undo_status in ('unavailable','available','undone','failed')),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create index if not exists assistant_runs_user_started_idx on public.assistant_runs (user_id, started_at desc);
create index if not exists assistant_actions_user_created_idx on public.assistant_actions (user_id, created_at desc);
create unique index if not exists assistant_actions_user_idempotency_idx on public.assistant_actions (user_id, idempotency_key) where idempotency_key is not null;

alter table public.notion_connections enable row level security;
alter table public.notion_assistant_settings enable row level security;
alter table public.assistant_runs enable row level security;
alter table public.assistant_actions enable row level security;

drop policy if exists notion_connections_owner_select on public.notion_connections;
create policy notion_connections_owner_select on public.notion_connections for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists notion_connections_owner_insert on public.notion_connections;
create policy notion_connections_owner_insert on public.notion_connections for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists notion_connections_owner_update on public.notion_connections;
create policy notion_connections_owner_update on public.notion_connections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists notion_connections_owner_delete on public.notion_connections;
create policy notion_connections_owner_delete on public.notion_connections for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists notion_assistant_settings_owner_select on public.notion_assistant_settings;
create policy notion_assistant_settings_owner_select on public.notion_assistant_settings for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists notion_assistant_settings_owner_insert on public.notion_assistant_settings;
create policy notion_assistant_settings_owner_insert on public.notion_assistant_settings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists notion_assistant_settings_owner_update on public.notion_assistant_settings;
create policy notion_assistant_settings_owner_update on public.notion_assistant_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists notion_assistant_settings_owner_delete on public.notion_assistant_settings;
create policy notion_assistant_settings_owner_delete on public.notion_assistant_settings for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists assistant_runs_owner_select on public.assistant_runs;
create policy assistant_runs_owner_select on public.assistant_runs for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists assistant_runs_owner_insert on public.assistant_runs;
create policy assistant_runs_owner_insert on public.assistant_runs for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists assistant_runs_owner_update on public.assistant_runs;
create policy assistant_runs_owner_update on public.assistant_runs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists assistant_runs_owner_delete on public.assistant_runs;
create policy assistant_runs_owner_delete on public.assistant_runs for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists assistant_actions_owner_select on public.assistant_actions;
create policy assistant_actions_owner_select on public.assistant_actions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists assistant_actions_owner_insert on public.assistant_actions;
create policy assistant_actions_owner_insert on public.assistant_actions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists assistant_actions_owner_update on public.assistant_actions;
create policy assistant_actions_owner_update on public.assistant_actions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists assistant_actions_owner_delete on public.assistant_actions;
create policy assistant_actions_owner_delete on public.assistant_actions for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.notion_connections to authenticated;
grant select, insert, update, delete on public.notion_assistant_settings to authenticated;
grant select, insert, update, delete on public.assistant_runs to authenticated;
grant select, insert, update, delete on public.assistant_actions to authenticated;
