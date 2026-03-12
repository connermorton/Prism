-- Prism 1.0 — Knowledge Lineage Database Schema
-- Run this in the Supabase SQL editor

-- ─────────────────────────────────────────────
-- explorations
-- ─────────────────────────────────────────────
create table if not exists explorations (
  id          uuid primary key default gen_random_uuid(),
  claim       text not null,
  synthesis   text,
  blind_spot  text,
  graph_data  jsonb,          -- full nodes + edges payload for fast loading
  is_public   boolean default false,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- nodes (deduplicated across all explorations)
-- ─────────────────────────────────────────────
create table if not exists nodes (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  thinker       text,
  era           text,
  period        text,
  description   text,
  key_insight   text,
  canonical_id  text unique not null   -- lowercase(label):lowercase(thinker)
);

-- ─────────────────────────────────────────────
-- exploration_nodes (junction)
-- ─────────────────────────────────────────────
create table if not exists exploration_nodes (
  exploration_id  uuid not null references explorations (id) on delete cascade,
  node_id         uuid not null references nodes (id) on delete cascade,
  is_root         boolean default false,
  primary key (exploration_id, node_id)
);

-- ─────────────────────────────────────────────
-- exploration_edges
-- ─────────────────────────────────────────────
create table if not exists exploration_edges (
  id               uuid primary key default gen_random_uuid(),
  exploration_id   uuid not null references explorations (id) on delete cascade,
  source_node_id   uuid not null references nodes (id),
  target_node_id   uuid not null references nodes (id),
  relationship     text
);

-- ─────────────────────────────────────────────
-- connections (auto-detected cross-exploration links)
-- ─────────────────────────────────────────────
create table if not exists connections (
  id                uuid primary key default gen_random_uuid(),
  node_id           uuid not null references nodes (id) on delete cascade,
  exploration_a_id  uuid not null references explorations (id) on delete cascade,
  exploration_b_id  uuid not null references explorations (id) on delete cascade,
  created_at        timestamptz default now(),
  unique (node_id, exploration_a_id, exploration_b_id)
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
create index if not exists idx_nodes_canonical_id
  on nodes (canonical_id);

create index if not exists idx_exploration_nodes_node_id
  on exploration_nodes (node_id);

create index if not exists idx_connections_node_id
  on connections (node_id);

create index if not exists idx_connections_exploration_a
  on connections (exploration_a_id);

create index if not exists idx_connections_exploration_b
  on connections (exploration_b_id);

create index if not exists idx_explorations_created_at
  on explorations (created_at desc);
