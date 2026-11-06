-- Cloud agent tables (Neon Postgres). Run: npm run agent:migrate
create table if not exists agent_intents (
  id text primary key,
  prompt text not null,
  state_snapshot jsonb not null,
  address text,
  signature text,
  nonce text,
  test_mode boolean not null default false,
  status text not null default 'queued',
  reply jsonb,
  source text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_intents_status_idx on agent_intents (status, created_at);

create table if not exists agent_events (
  id text primary key,
  intent_id text references agent_intents(id) on delete set null,
  action text not null,
  tier smallint not null default 0,
  title text not null default '',
  authorizers jsonb not null default '[]',
  tx_hash text,
  simulated boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists agent_events_created_idx on agent_events (created_at desc);
