-- STEP19(CPO 지시, 2026-09-08) — 사장님이 올린 엑셀 원본을 Admin이 다시 받을 수 있게 한다.
--
-- 지금까지 업로드된 엑셀은 파싱 직후 사라졌다. `imports.file_name`은 이름 문자열일 뿐이고
-- 원본 바이트는 요청이 끝나면 없어졌다. 그래서 실사용 계정(user2 등)의 데이터로 테스트하려면
-- 매번 사장님에게 "그 파일 다시 보내주세요"라고 요청해야 했다.
--
-- ── 이 마이그레이션이 하는 것 ──────────────────────────────────────────
--   1) private storage bucket `import-originals` 생성
--   2) `imports.file_path` (text, nullable) 추가 — 원본 오브젝트 경로
--
-- ── 하지 않는 것 ──────────────────────────────────────────────────────
--   과거 업로드 소급 복구(원본이 애초에 없다). 기존 행은 file_path = null로 남고
--   Admin 화면에서 다운로드 버튼이 나타나지 않는다. 주문/고객 구조 변경 0.
--
-- ── 접근 제어 ─────────────────────────────────────────────────────────
--   버킷은 public = false. storage.objects에는 RLS가 켜져 있고 이 버킷에 대한
--   정책을 **하나도 만들지 않는다** — 따라서 anon/authenticated 역할로는 읽기·쓰기가
--   전부 차단되고, RLS를 우회하는 service_role(서버 코드)만 접근할 수 있다.
--   서명 URL도 서버에서만 만들고, 경로는 앞단에 tenant_id를 두어 한 겹 더 격리한다.
--
--   원본에는 고객 이름·주소·연락처가 그대로 들어 있다. 보관기간/파기 정책은
--   CPO가 별도로 정하기로 했고(2026-09-08), 이 마이그레이션은 그 정책을 앞서
--   결정하지 않는다 — 자동 삭제 크론을 여기서 만들지 않는 이유다.

insert into storage.buckets (id, name, public)
values ('import-originals', 'import-originals', false)
on conflict (id) do nothing;

alter table public.imports add column if not exists file_path text;

comment on column public.imports.file_path is
  'STEP19: import-originals 버킷 내 원본 엑셀 오브젝트 경로({tenant_id}/{uuid}.{ext}). null이면 원본 미보관(이 기능 이전에 등록된 건). Admin만 다운로드 가능.';
