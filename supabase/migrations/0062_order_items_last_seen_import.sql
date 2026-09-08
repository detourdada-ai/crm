-- STEP22 1단계(CPO 승인, 2026-09-08) — 상품주문번호가 **어느 파일에서 마지막으로
-- 확인됐는지** 기록할 기반.
--
-- ── 왜 필요한가 ────────────────────────────────────────────────────────
-- 스마트스토어 발송대기 파일은 이미 등록된 상품주문번호를 다시 올리면 **완전한
-- no-op**으로 건너뛴다(중복 생성 방지). 그래서 "이 주문이 오늘 파일에도 있었다"는
-- 사실이 DB 어디에도 남지 않고, 결과적으로 "직전에는 있었는데 오늘은 없다"를
-- 계산할 근거가 없다. 이 컬럼이 그 근거를 만든다.
--
-- ── 이 마이그레이션이 하는 것 ──────────────────────────────────────────
--   order_items.last_seen_import_id (uuid, nullable) + 조회용 인덱스
--
-- ── 하지 않는 것 ──────────────────────────────────────────────────────
--   자동 취소 판정 ❌ / delivery_status 변경 ❌ / 기존 중복판정 로직 변경 ❌
--   신규 테이블 ❌ / 기존 데이터 백필 ❌ (과거 행은 null로 남는다)
--   이번 단계는 **기록 기반만** 만든다. 취소 판정은 2단계에서 별도 승인 후.
--
-- ── ON DELETE SET NULL을 쓰는 이유와 그 결과 ──────────────────────────
--   `imports` 행은 STEP19 보관정책에 따라 30일 뒤 자동 파기된다. 그때 이 컬럼은
--   null이 된다. 따라서 2단계의 취소 판정은 반드시
--       "last_seen_import_id IS NOT NULL AND != 이번 import"
--   여야 한다. **null은 '사라졌다'가 아니라 '모른다'** — null을 사라진 것으로
--   취급하면 보관기간이 지난 정상 주문이 전부 잘못 취소된다.

alter table public.order_items
  add column if not exists last_seen_import_id uuid references public.imports (id) on delete set null;

create index if not exists idx_order_items_last_seen_import
  on public.order_items (tenant_id, last_seen_import_id);

comment on column public.order_items.last_seen_import_id is
  'STEP22-1: 이 상품주문번호가 마지막으로 등장한 import. null = 기록 없음(이 기능 이전 건이거나 해당 import가 보관기간 만료로 파기됨). null을 "파일에서 사라졌다"로 해석하지 말 것.';
