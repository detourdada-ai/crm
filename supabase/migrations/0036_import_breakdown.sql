-- P5: 엑셀 Import 결과 세분화 — "총 261건 → 157건"처럼 숫자 차이를 임의로
-- "정상 처리"라고 뭉개지 않고, success_rows 중 "이번 실행에서 이미 등록되어
-- 건너뛴" 행 수를 별도로 추적한다(신규 생성분과 구분).
alter table imports add column if not exists already_imported_rows integer not null default 0;
