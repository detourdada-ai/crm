-- Sprint 7 Phase 4: 정산관리 (기사별 배송 정산)

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  delivery_count integer not null default 0,
  amount numeric(12, 2) not null default 0,
  status text not null default 'unpaid',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, period_start, period_end)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlements_status_check') then
    alter table settlements add constraint settlements_status_check check (status in ('unpaid', 'paid'));
  end if;
end $$;

create index if not exists idx_settlements_driver_id on settlements (driver_id);
create index if not exists idx_settlements_period on settlements (period_start, period_end);

drop trigger if exists trg_settlements_updated_at on settlements;
create trigger trg_settlements_updated_at
  before update on settlements
  for each row execute function set_updated_at();
