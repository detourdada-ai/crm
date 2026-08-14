-- Beta 고객 모집 전환: 랜딩의 목적이 "가입시키기"에서 "Beta 후보군을 모집하고
-- 실제 사업자의 이야기를 듣기"로 바뀌면서 두 개의 새 플랫폼 레벨(테넌트 무관)
-- 테이블이 필요하다. 둘 다 비로그인 방문자가 직접 쓰는 공개 폼의 저장소다.

create table if not exists beta_recruit_applications (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  business_type text not null,
  avg_daily_orders text,
  order_channels text[] not null default '{}',
  delivery_method text,
  staff_count text,
  driver_count text,
  current_order_management text,
  current_delivery_management text,
  uses_excel boolean not null default false,
  uses_kakao_sms boolean not null default false,
  biggest_pain_point text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_beta_recruit_applications_created_at on beta_recruit_applications (created_at desc);

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null,
  title text not null,
  message text not null,
  status text not null default '접수' check (status in ('접수', '확인중', '답변완료')),
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inquiries_created_at on inquiries (created_at desc);
create index if not exists idx_inquiries_status on inquiries (status);

drop trigger if exists trg_inquiries_updated_at on inquiries;
create trigger trg_inquiries_updated_at
  before update on inquiries
  for each row execute function set_updated_at();

alter table beta_recruit_applications enable row level security;
alter table inquiries enable row level security;
