-- 랜딩 UX/UI 개선: 모집 폼 필수 입력을 이름/연락처/업종으로 최소화한다.
-- company_name, biggest_pain_point는 이제 선택 입력이므로 NOT NULL을 해제한다.
-- 나머지 필드는 기존 그대로 사용(새 컬럼 추가 없음).

alter table beta_recruit_applications
  alter column company_name drop not null,
  alter column biggest_pain_point drop not null;
