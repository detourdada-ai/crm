-- S2-C: 기사 운행시작/운행종료 + 참고용 최근 위치.
--
-- "기사 배정 = 배송중"이라는 기존 배송 상태 전이는 그대로 유지하고(변경
-- 없음), 이 테이블은 그 위에 얹는 별도의 운영 기록이다 — 배송 상태를
-- 절대 결정하지 않는다. 위치는 이력 로그가 아니라 "최근 값 하나"만
-- 덮어쓴다(GPS 추적 정책은 이번 스프린트 범위 밖 — CPO 지시).
create table if not exists driver_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  shift_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  last_latitude double precision,
  last_longitude double precision,
  last_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, shift_date)
);

create index if not exists idx_driver_shifts_driver_date on driver_shifts (driver_id, shift_date desc);

drop trigger if exists trg_driver_shifts_updated_at on driver_shifts;
create trigger trg_driver_shifts_updated_at
  before update on driver_shifts
  for each row execute function set_updated_at();
