-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)

create table if not exists public.fuel_logs (
  id bigint generated always as identity primary key,
  log_date date not null,
  boat_name text not null,
  fuel_type text not null check (fuel_type in ('petrol','diesel')),
  section text,                       -- coral | outrigger
  quantity numeric not null default 0,
  unit text not null default 'Ltrs',
  image_hash text,                    -- sha256 of the chit photo (dedup)
  image_url text,
  image_path text,
  raw_ocr_text text,
  telegram_user text,
  telegram_message_id bigint,
  source text default 'telegram',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists fuel_logs_date_idx on public.fuel_logs (log_date);
create index if not exists fuel_logs_type_idx on public.fuel_logs (fuel_type);
create index if not exists fuel_logs_boat_idx on public.fuel_logs (boat_name);
-- Used to detect a chit photo that was already processed.
create index if not exists fuel_logs_image_hash_idx on public.fuel_logs (image_hash);

-- All access goes through the service key on the server; RLS stays enabled with
-- no public policies so the anon key can't read/write directly.
alter table public.fuel_logs enable row level security;

-- Upgrading an older version? add missing columns:
-- alter table public.fuel_logs add column if not exists section text;
-- alter table public.fuel_logs add column if not exists image_hash text;

-- After running this, create a Storage bucket:
-- Supabase dashboard -> Storage -> New bucket -> name: fuel-chits -> Public bucket: ON
-- This is where the original chit photos get archived for reference.
