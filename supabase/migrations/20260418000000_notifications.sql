-- Notifications for SecureFlow (read via API using service role; optional RLS later for direct client access)

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  type text not null check (type in ('milestone', 'dispute', 'escrow', 'application', 'message', 'rating')),
  title text not null,
  message text not null,
  read_at timestamptz,
  action_url text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_wallet_created_idx
  on public.notifications (wallet_address, created_at desc);
