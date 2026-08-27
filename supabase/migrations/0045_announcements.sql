-- STEP8-C(2026-08-27 CPO 작업지시): 기능 개선사항을 사장님에게 로그인 시
-- 안내하는 공지 시스템. inquiries 테이블과 동일한 패턴(Admin 작성 →
-- 일반 사용자 목록/상세 조회)을 따른다.
--
-- "오늘 그만 보기"는 (username, announcement_id) 단위로 dismissal 행을
-- 남기는 방식이다 — 날짜 컬럼 하나로 "오늘만 숨김"을 흉내내는 대신,
-- 한 번 닫은 공지는 그 계정에서 다시 뜨지 않는다(CPO 지시: "같은 공지를
-- 무한 반복하는 방식은 피한다"). 새 공지가 게시되면 그 공지는 dismissal
-- 행이 없으므로 정상적으로 다시 표시된다.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  body text not null,
  category text not null default '일반공지' check (category in ('기능개선', '일반공지')),
  status text not null default '게시중' check (status in ('게시중', '종료')),
  show_popup boolean not null default true,
  published_at date not null default (now() at time zone 'Asia/Seoul')::date,
  created_by text not null references app_accounts (username),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_published_at on announcements (published_at desc);
create index if not exists idx_announcements_status on announcements (status);

drop trigger if exists trg_announcements_updated_at on announcements;
create trigger trg_announcements_updated_at
  before update on announcements
  for each row execute function set_updated_at();

create table if not exists announcement_dismissals (
  username text not null references app_accounts (username) on delete cascade,
  announcement_id uuid not null references announcements (id) on delete cascade,
  dismissed_date date not null,
  created_at timestamptz not null default now(),
  primary key (username, announcement_id)
);

create index if not exists idx_announcement_dismissals_username on announcement_dismissals (username);

alter table announcements enable row level security;
alter table announcement_dismissals enable row level security;
