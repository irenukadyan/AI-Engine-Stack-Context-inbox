-- AI Context Inbox: account, device, and transfer-routing foundation.
-- Apply through Supabase CLI or SQL editor after creating the project.

create extension if not exists pgcrypto;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  platform text not null check (platform in ('vscode', 'windows-companion', 'macos-companion', 'linux-companion')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 160),
  is_open boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.devices(id) on delete cascade,
  pairing_secret_hash text not null unique,
  expires_at timestamptz not null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists public.transfer_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  project_id uuid references public.workspace_projects(id) on delete set null,
  kind text not null check (kind in ('file', 'note', 'agent-follow-up', 'approval-response')),
  status text not null default 'queued' check (status in ('queued', 'delivered', 'failed', 'cancelled')),
  object_key text,
  note_preview text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists transfer_events_device_created_idx on public.transfer_events(device_id, created_at desc);
create index if not exists workspace_projects_device_idx on public.workspace_projects(device_id);

alter table public.devices enable row level security;
alter table public.workspace_projects enable row level security;
alter table public.pairing_requests enable row level security;
alter table public.transfer_events enable row level security;

create policy "users can view their devices" on public.devices for select using (auth.uid() = user_id);
create policy "users can update their devices" on public.devices for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users can view projects on their devices" on public.workspace_projects for select using (
  exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid())
);
create policy "users can view their transfers" on public.transfer_events for select using (auth.uid() = user_id);

-- Pairing creation, claim, device token issuance, and transfer delivery must be
-- implemented in server-side Edge Functions using the service role. Do not add
-- direct client insert policies for these sensitive actions.
