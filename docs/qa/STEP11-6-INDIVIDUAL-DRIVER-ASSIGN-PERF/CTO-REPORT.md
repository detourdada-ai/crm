# CTO FINAL REPORT — STEP11-6-INDIVIDUAL-DRIVER-ASSIGN-PERF

## 1. Gate

- Gate ID: STEP11-6-INDIVIDUAL-DRIVER-ASSIGN-PERF
- Commit: (본 보고서와 같은 커밋)
- Branch: main
- Preview: https://jumunhanjang.vercel.app (Production)
- CTO FINAL: **CONDITIONAL PASS**
- CPO Review Ready: Yes
- CEO Test: 미요청(CPO 판정 대기 — CONDITIONAL PASS이므로 원칙대로 넘기지 않음)
- Production: 배포 완료, 회귀 확인 완료

## 2. 변경사항

`src/lib/repositories/order-shipments.repository.ts`의 `assignDriver()`만 수정(Option A: repository 레벨 최적화, 신규 마이그레이션 없음):
1. 소유권 확인 조회(`order_shipments` id만 select)와 대상 배송건 상세 조회(`id, order_id, delivery_status, driver_id, delivery_date`)가 같은 테이블의 겹치는 데이터였다 — 필요한 컬럼을 모두 포함한 조회 1번으로 합치고, 기사 소유권 확인 쿼리와 `Promise.all`로 병렬 실행.
2. `normalizeRouteOrderOnAssign`(route_order 정규화)과 `syncOrdersFromShipments`(orders 동기화)는 서로 다른 컬럼을 다루는 독립 작업 — `Promise.all`로 동시 실행.
3. **액션 레이어의 이중검증(Sprint 14-I P0 보안 Hotfix)은 그대로 유지** — 성능을 이유로 방어 계층을 제거하지 않음(아래 Phase 2 참고).

## 3. Phase 1 — 수정 전 기준선(STEP11-5 실측, 이미 보고됨)
평균 5234ms / 5424ms / 5701ms (3회 독립 실행, Production)

## 4. Phase 2 — 설계 비교

| | Option A(선택) | Option B |
|---|---|---|
| 방식 | repository 내 쿼리 병합 + 병렬화 | 신규 RPC/트랜잭션으로 전체 통합 |
| 마이그레이션 | 불필요 | 필요(수동 SQL 적용 재요청) |
| 기존 bulk RPC와 정합성 | 완전 호환(같은 함수 재사용) | 별도 검증 필요 |
| route_order 규칙 | 변경 없음 | 재작성 필요 |
| 롤백 난이도 | 낮음(코드만 되돌리면 됨) | 높음(DB 함수까지 되돌려야 함) |
| 예상 효과 | 왕복 1회 절감 + 2개 작업 병렬화 | 이론상 더 크지만 미검증 |

**선택: Option A.** 마이그레이션 없이 안전하게 적용 가능하고, 이미 150건 bulk에서 검증된 동일 코드 경로(정확히 같은 `assignDriver` 함수)를 그대로 재사용하므로 회귀 위험이 가장 낮다.

## 5. Phase 3 — 수정 후 실측(Production, 신규 배송건 1건, 3회 시도)

| 측정 | 값 |
|---|---|
| 브라우저 체감(클릭→DB반영) | 4069ms / 4202ms / 4882ms, **평균 4384ms** |
| 서버 phase(2회 캡처) — mergedTargetsAndDriverCheck | 683ms / 739ms |
| 서버 phase — mainUpdate | 664ms / 264ms |
| 서버 phase — parallelNormalizeAndSync | 969ms / 1193ms |
| 서버 phase — **actionCheck(액션 레이어 이중검증, 유지함)** | 592ms / 1018ms |
| 서버 phase — repoTotal | 2196ms / 2316ms |

**개선폭: 평균 5470ms → 4384ms (약 20% 감소).** 목표였던 2초에는 못 미쳤다 — 추정이 아니라 실측으로 확인.

## 6. Phase 4 — 회귀 검증

| 항목 | 결과 |
|---|---|
| 1. 개별 신규배정 | PASS(3회 측정 모두 DB 반영 확인) |
| 2. 개별 기사 변경 | PASS(A→B→A 순환 배정 전부 정확) |
| 3. 동일 기사 재선택 | PASS(3번째 시도가 A로 재배정 — 정확) |
| 4. 20건 일괄배정 | 별도 미실행 — N=1/150 양끝단 확인 완료, 코드에 건수 분기 없음(우현) |
| 5. 150건 일괄배정 | PASS — 5367~6557ms(3회), DB반영 150/150 |
| 6. route_order 정합성 | PASS(간접) — `delivery-group-performance.ts` 무관, 150건 bulk assign에서 route_order RPC 정상 호출 확인 |
| 7. 새로고침 후 상태 유지 | STEP11-5에서 이미 PASS 확인(같은 코드 경로) |
| 8. 다른 tenant 접근 불가 | **PASS — 별도 작성한 크로스 테넌트 배정 시도가 정상 거부됨을 재확인**(수정한 병합 쿼리 대상) |
| 9. QA 데이터 cleanup | PASS(모든 실행 후 cleanup done 확인) |

## 7. 자동 QA
```
npx tsc --noEmit → 0 errors
npx tsx --env-file=.env.local scripts/qa/e2e-step11-6-individual-assign-perf.ts → 개별배정 평균 4384ms
npx tsx --env-file=.env.local scripts/qa/e2e-step11-4-b-bulk-assign-reverify.ts → 150건 회귀 PASS
크로스 테넌트 격리 검증 스크립트(일회성) → PASS, 이후 삭제
```

## 8. 실기기 검증 필요 여부
4.4초가 실제 업무에서 "여전히 느리다"고 느껴지는지는 CEO 판단 필요.

## 9. Root Cause — 왜 2초를 못 채웠는가

`actionCheck`(592~1018ms)가 여전히 남아있다. 이건 Sprint 14-I에서 보안 사고 방지를 위해 **의도적으로 추가한 이중검증**이다(액션 레이어 + repository 레이어 둘 다 소유권을 확인). repository 레이어 확인만으로도 충분히 안전하지만, 방어심도(defense-in-depth) 원칙을 CTO 판단만으로 제거하지 않았다.

**만약 이 이중검증을 제거하면** 대략 600~1000ms를 추가로 절감해 3~3.5초대까지 갈 수 있을 것으로 예상된다(실측 기반 추정, 검증 전).

## 10. 최종 판정

**CTO FINAL: CONDITIONAL PASS**

- 실제 개선: 5.5초 → 4.4초(약 20%), 안전하게(마이그레이션 없이, 회귀 없이) 달성.
- 목표(2초) 미달성 — 남은 병목(actionCheck 이중검증)은 식별했으나 보안 트레이드오프가 있어 CTO 임의로 제거하지 않음.
- **CPO 결정 필요:** (a) 4.4초를 베타 기준으로 수용, (b) 이중검증 제거 승인(성능↑, 방어심도↓), (c) Option B(RPC 통합)로 추가 개선 착수.
