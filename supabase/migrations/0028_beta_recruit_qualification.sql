-- Phase 9 (실제 고객검증 운영 준비): Section 3의 사업/주문/배송/현재관리방식/
-- 핵심불편사항 필드는 0027에서 이미 전부 수집 중이므로 추가하지 않는다.
-- 이번 마이그레이션은 (1) 모집 지원 진행 상태 관리, (2) 인터뷰 결과 기록,
-- (3) 문제 분류 체계, (4) 문의 게시판 유형 분류만 최소로 추가한다.

alter table beta_recruit_applications
  add column if not exists status text not null default '신규'
    check (status in ('신규', '연락예정', '인터뷰완료', 'Beta후보', 'Beta참여', '보류')),
  add column if not exists interview_notes text,
  add column if not exists problem text,
  add column if not exists current_solution text,
  add column if not exists frequency text,
  add column if not exists severity text,
  add column if not exists current_workaround text,
  add column if not exists product_fit text,
  add column if not exists problem_categories text[] not null default '{}';

create index if not exists idx_beta_recruit_applications_status on beta_recruit_applications (status);

alter table inquiries
  add column if not exists category text not null default '기타'
    check (category in ('버그', '사용법', '불편사항', '기능요청', '기타'));
