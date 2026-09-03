# QA 스크립트 자산 목록 (QA Script Inventory)

> Sprint S13(2026-09-03) 작성. 저장소의 QA 스크립트가 **왜 존재하고 / 무엇을 검증하며 /
> 재실행 가능한지**를 추적하기 위한 목록이다. 보존/삭제 판단은
> [QA-DATA-POLICY.md](./QA-DATA-POLICY.md) §5를 따른다.

## 취급 원칙

- 이 목록의 스크립트는 전부 **저장소 자산**이다. "임시"라는 이유로 삭제하지 않는다.
- 저장소 편입 조건: `tsc` PASS + `ESLint` PASS (S13에서 전체 통과 확정).
- 실행 형식(공통):
  ```bash
  NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config <경로> dotenv_config_path=.env.local
  ```
- QA 쓰기가 허용된 tenant는 `user3` **하나뿐**이다(STEP12-17 기본 거부). `user4`/`user5`는
  실제 업무 데이터가 확인돼 제외됐고, `user1`/`user2`는 조회조차 하지 않는다.
- 두 번째 tenant를 쓰던 스크립트 15개는 현재 `assertAllowedQaOwner()`에서 **의도적으로
  fail-fast** 한다 — 전용 QA tenant가 생기기 전까지 실행되지 않는 것이 정상이다.
- 대부분 Playwright로 **Production(jumunhanjang.vercel.app)** 을 실제 클릭한다. 실행 시
  QA 데이터를 만들고 `finally`에서 스스로 정리한다.

## 1. 상시 회귀 (기능이 바뀌면 다시 돌리는 것)

| 스크립트 | 검증 대상 |
|---|---|
| `qa/delivery-flow.ts` | 배송관리 + 기사앱 기본 사이클 |
| `qa/delivery-next-flow.ts` | 기사앱 "배송완료 → 다음 배송 자동전환" |
| `qa/delivery-group-ux-flow.ts` | 배송그룹 카드 UX(정규화/혼합건물/배송순서) |
| `qa/delivery-group-performance.ts` | 배송그룹 재계산 안정성·성능 |
| `qa/delivery-group-partial-failure-flow.ts` | 배송그룹 부분 실패/유령 그룹 정합성 |
| `qa/region-filter-flow.ts` | 지역 3단 멀티필터 + Export |
| `qa/region-filter-mobile-check.ts` | 지역 필터 390px 모바일 스팟체크 |
| `qa/driver-shift-completion-flow.ts` | 기사 운행상태/배송완료 UX |
| `qa/settlement-flow.ts` | 정산 집계/지급관리/기사 필터 |
| `qa/account-management.ts` | 계정관리·기사관리 분리 |
| `qa/announcements-flow.ts` | 공지/게시글 CRUD·권한 |
| `qa/beta-flow.ts` | 베타 오픈 준비(PART B3/B4) |
| `qa/import-dedup-flow.ts` | 누적 엑셀 중복 판정 |
| `qa/import-identity-conflict-flow.ts` | identity 충돌 처리 |
| `qa/import-step2-product-order.ts` | 스마트스토어 product_order 기준 중복 판정 |

## 2. Gate별 검증 (해당 STEP의 요구사항 증거)

`docs/qa/<GATE-ID>/CTO-REPORT.md`가 결과를 인용한다. **삭제하면 그 보고서의 증거 추적이 끊긴다.**

| 스크립트 | Gate |
|---|---|
| `qa/e2e-p2-scenario-a-smartstore-excel.ts` | STEP10 E2E Scenario A(스마트스토어 엑셀 사이클) |
| `qa/e2e-p2-scenario-b-standard-excel.ts` | Scenario B(자체 표준 엑셀) |
| `qa/e2e-p2-scenario-c-crud.ts` | Scenario C(전화/수동주문 CRUD) |
| `qa/e2e-p2-scenario-d-fulfillment.ts` | Scenario D(자체배송/직접수령 분기) |
| `qa/e2e-p2-scenario-e-groups.ts` | Scenario E(배송그룹 자동계산) — STEP11-11 보고서 인용 |
| `qa/e2e-p2-scenario-gh-driver-cycle.ts` | Scenario G/H(기사 배송 사이클·다중기사) |
| `qa/e2e-p2-scenario-i-settlement.ts` | Scenario I(정산 전체 사이클) |
| `qa/e2e-p2-driver-creation.ts` | 실제 기사 계정 생성 |
| `qa/e2e-p3-user4-isolation.ts` | 테넌트 격리 — STEP11-7 / STEP11-11 보고서 인용 |
| `qa/e2e-p4-user5-crud-stress.ts` | Import/CRUD 스트레스 |
| `qa/e2e-final-cpo-test-ready.ts` | CPO 인계 상태 생성 |
| `qa/e2e-step11-1a-smartstore-cumulative.ts` | STEP11-1-A 누적 다운로드 패턴 |
| `qa/e2e-step11-1a1-orphan-customer-rootcause.ts` | STEP11-1-A-1 고아 고객 근본원인 |
| `qa/e2e-step11-1b2-filter-performance.ts` | STEP11-1-B-2 필터/일괄배정 성능 |
| `qa/e2e-step11-2-phase4-date-filter.ts` | STEP11-2 Phase4 날짜 기준 접수 |
| `qa/e2e-step11-2d-assign-performance.ts` | STEP11-2-D 일괄배정 성능 |
| `qa/e2e-step11-3-cpo-integrated-validation.ts` | STEP11-3 통합 실사용 검증 |
| `qa/e2e-step11-4-b-bulk-assign-reverify.ts` | **일괄배정 성능 기준선**(10/50/100/150건 × 3회, Draft/저장/DB 구간 분리 측정 + baseline diff) |
| `qa/e2e-step11-5-cpo-requirement-verification.ts` | STEP11-5 CPO 요구사항 검증 |
| `qa/e2e-step11-6-individual-assign-perf.ts` | STEP11-6 개별 배정 성능 |
| `qa/e2e-step11-7-access-boundary.ts` | STEP11-7 role 기반 접근 경계 |
| `qa/e2e-step11-11-group-redesign.ts` | STEP11-11 배송그룹 재설계 |
| `qa/step11-13-draft-batch-save.ts` | STEP11-13 변경사항 일괄저장(Draft) |
| `qa/step11-14-delivery-assignment-ux.ts` | STEP11-14 개별 vs 일괄배정 UX |
| `qa/step12-1-beta-open-ready.ts` | STEP12-1 베타 오픈 준비 |
| `qa/step12-2-final-operation-audit.ts` | STEP12-2 오픈 직전 운영 점검 |
| `qa/step12-8f-phase3-r05-product-alias.ts` | STEP12-8F R05 상품 별칭 |
| `qa/step12-8f-phase4-r10-r11-dnd.ts` | STEP12-8F R10/R11 D&D + 일괄저장 |
| `qa/step12-8g-r01-04-07-verification.ts` | STEP12-8G R01~R08 재검증 |
| `qa/step12-8g-r14-18-verification.ts` | STEP12-8G R14~R18 재검증 |
| `qa/step12-8h-product-order-quantity-count.ts` | STEP12-8H 상품주문 수량합 카운트 |
| `qa/step12-9-r20-announcement-dismiss.ts` | STEP12-9 R20 공지 "오늘 그만 보기" |
| `qa/step12-10-r04-phone-policy.ts` | STEP12-10 R04 연락처 정책 |
| `qa/step12-10-r06-r08-product-summary.ts` | STEP12-10 R06/R08 세트메뉴 집계 |
| `qa/step12-11-delivery-ui-cleanup.ts` | STEP12-11 R21~R26 배송 UI + **STEP12-16B 회귀 기준선** |
| `qa/step12-11-r15-19-driver-verification.ts` | STEP12-11 R15~R19 기사앱 |
| `qa/step12-12-permission-attack-surface.ts` | STEP12-12 R27~R30 권한 공격면 |
| `qa/step12-15-merge-unmerge.ts` | STEP12-15 고객 병합/병합취소 |

## 3. 공통 라이브러리 (삭제 시 전 스크립트 동작 불가)

| 파일 | 역할 |
|---|---|
| `qa/lib/qa-config.ts` | 테넌트 정책 상수, `QA_NAME_PREFIX` |
| `qa/lib/qa-guard.ts` | `assertAllowedQaOwner` / `assertTenantIsQaSafe` / `makeRunTag` / QA 기사 생성·정리 / `cleanupQaDeliveryGroups` / `captureTenantBaseline`·`diffTenantBaseline` |
| `qa/lib/qa-session.ts` | 위조 세션 토큰(로그인 우회) |
| `scripts/safe-scratch.ts` | Production 쓰기 스크래치용 스냅샷·자동원복 래퍼, `ALLOWED_TEST_OWNERS` |
| `qa/provision-qa-tenant.ts` | QA 전용 tenant 생성(실서비스와 동일한 create_seller_signup 경로, 멱등) |

## 4. 조사(읽기 전용) 스크립트

| 스크립트 | 목적 |
|---|---|
| `qa/data-integrity-audit.ts` | **STEP12-17 상시 감사** — 주문↔배송 orphan/중복, 배송상태 조합, `route_order` 중복·구멍, 병합 제거 고객의 주문 연결을 tenant별로 점검(쓰기 없음, user1/user2 조회 거부) |
| `scripts/production-final-qa-readonly.ts` | Production 데이터 정합성 읽기 전용 점검 |
| `scripts/step11-8-delivery-group-investigation.ts` | 배송그룹 실사용성 조사 |
| `scripts/step11-9-delivery-group-redesign-investigation.ts` | 배송그룹 재설계 조사 |
| `scripts/step11-10a-delivery-group-metrics-and-naming.ts` | 배송그룹 지표/네이밍 조사 |
| `scripts/step11-10c-click-simulation.ts` | 기사 배정 클릭 횟수 시뮬레이션 |
| `scripts/step11-11-verify-real-algorithm.ts` | 재설계 알고리즘 실데이터 비교 |
| `scripts/p0-backfill-delivery-groups.ts` | 배송그룹 backfill(쓰기 — 스냅샷 필수) |

## 5. 유지보수 규칙

1. 새 QA 스크립트는 반드시 `qa/lib/qa-guard.ts`의 `makeRunTag()` + `QA_NAME_PREFIX`를 쓴다.
2. cleanup은 `finally`에서 그 실행의 RUN_TAG로만 좁혀 수행한다.
3. 스크립트를 추가/삭제하면 이 목록을 같이 갱신한다.
4. `npx eslint .`가 깨진 채로 커밋하지 않는다.
