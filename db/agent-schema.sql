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

-- DAO member invites. Off-chain until claimed. The member signs a message to
-- derive the secret, computes the Poseidon commitment, and the admin adds that
-- commitment to DaoCore. The invited address is the public identity and the
-- secret never leaves the member's browser.
create table if not exists dao_invites (
  code text primary key,
  dao text not null,
  address text not null,
  label text,
  commitment text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists dao_invites_dao_idx on dao_invites (dao, created_at desc);

-- Chat threads per DAO. The agent conversation is not on-chain state, so it
-- lives in Postgres. Each message stores the same payload the UI renders:
-- { text } for a user message, { plan } or { refusal } for the agent.
create table if not exists dao_conversations (
  id text primary key,
  dao text not null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dao_conversations_dao_idx on dao_conversations (dao, updated_at desc);

create table if not exists dao_messages (
  id text primary key,
  conversation_id text not null references dao_conversations(id) on delete cascade,
  role text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists dao_messages_conversation_idx on dao_messages (conversation_id, created_at);
