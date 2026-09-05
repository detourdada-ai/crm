# 회귀 게이트 (Regression Gate) — 무엇을 바꾸면 무엇을 돌리는가

> STEP13 PHASE B / 2026-09-04. PHASE A(cleanup 전수 감사)는 `fbe4564`.
> 지금까지 "어떤 QA를 돌려야 하는지"는 사람의 기억에 있었다. 다음 기능 개발이
> 시작되기 전에 **변경 영역 → 필수 실행 스크립트**를 고정한다.

## 0. 공통 규칙

```bash
NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config <경로> dotenv_config_path=.env.local
```

- 쓰기 허용 tenant는 `user3`(보조 `user6`)뿐이다. `user1`/`user2`는 조회도 하지 않는다.
- **PASS 기준은 assertion 통과 + `cleanup: baseline 복귀`(diff = 0) 두 가지 모두**다.
  잔존 0건이 아니라 baseline 복귀가 기준이다.
- 실패 시 금지: assertion 삭제 / 항목 skip / 기준 완화 / retry·sleep 증량으로 덮기.
- 성능 항목은 같은 스크립트·같은 건수로만 비교한다(§4 기준선).

## 1. 변경 영역 → 필수 게이트

| 바꾼 곳 | 반드시 돌릴 것 | 왜 |
|---|---|---|
| 주문 등록·수정·삭제 (`actions/orders`, `orders.repository`) | `e2e-p2-scenario-c-crud` · `e2e-p2-scenario-d-fulfillment` · `step12-10-r04-phone-policy` | 주문 CRUD와 자체배송/직접수령 분기, 연락처 정책 |
| 엑셀 Import (`import.service`, `column-mapping.service`) | `import-dedup-flow` · `import-identity-conflict-flow` · `import-step2-product-order` · `e2e-p2-scenario-a-smartstore-excel` · `e2e-p2-scenario-b-standard-excel` | 중복 판정·identity 충돌이 가장 자주 깨진 지점 |
| 주문 가져오기 범위·접수 설정 (`import-scope-settings.service`, `column-mapping-form`) | `step14-import-scope-default` + 위 Import 3종 | 기본값이 조용히 바뀌면 잘못된 범위로 접수된다 |
| 고객 연결·병합 (`customers.repository`, 동일인 후보) | `step12-15-merge-unmerge` · `e2e-step11-1a1-orphan-customer-rootcause` | 병합/병합취소 후 주문 연결이 끊긴 사고 이력 |
| 배송 목록·필터·그룹 (`delivery-board`, `delivery-groups`) | `step12-11-delivery-ui-cleanup` · `delivery-group-ux-flow` · `delivery-group-partial-failure-flow` · `region-filter-flow` | UI 정리 회귀 기준선 + 유령 그룹 정합성 |
| **저장(Draft) 경로** (`saveDeliveryDraftAction`, 일괄저장) | `step11-13-draft-batch-save` · `step12-8f-phase4-r10-r11-dnd` · `step11-14-delivery-assignment-ux` | 조용한 부분 저장 실패가 가장 위험 |
| 기사 배정·순서 (`assignDriver`, `reorderForDriver`, override) | `step12-8g-r01-04-07-verification` · `step12-8f-phase4-r10-r11-dnd` · `e2e-step11-11-group-redesign` | 저장 누락(STEP12-16B) 재발 감지 |
| 기사앱 (`/driver`) | `delivery-flow` · `delivery-next-flow` · `driver-shift-completion-flow` · `step12-11-r15-19-driver-verification` | 사장님 화면과 기사 화면의 상태 동기화 |
| 정산 | `settlement-flow` · `e2e-p2-scenario-i-settlement` | 배송완료 → 정산 연결 |
| 권한·역할 (`requireSession`, role 분기) | `step12-12-permission-attack-surface` · `e2e-step11-7-access-boundary` | 권한 공격면 |
| 테넌트 격리 (`owner_username`/`tenant_id` 조건) | `e2e-p3-user4-isolation` · `data-integrity-audit` | 다른 사장님 데이터 노출은 즉시 STOP 사유 |
| 공지·게시글 | `announcements-flow` · `step12-9-r20-announcement-dismiss` | 팝업이 다른 QA를 가리는 부작용 포함 |
| 베타 접근·가입 | `beta-flow` · `step12-1-beta-open-ready` | 가입 직후 첫 화면 |
| 랜딩/마케팅 페이지만 변경 | (제품 QA 불필요) `tsc` + `ESLint` + `next build` + 배포 후 HTTP 200 · 카피 노출 확인 | 제품 동작에 영향 없음 |
| **제품 UI 변경 시 → §1-1 Landing Product Parity Gate** | 랜딩 목업 영향 확인(3문항) | 랜딩이 실제와 어긋나면 그 순간부터 "가짜 제품 화면"이 된다 |

## 1-1. Landing Product Parity Gate (CPO 결정, 2026-09-05)

랜딩(`src/components/landing/product-screens.tsx`)은 실제 제품 화면을 **재현**한 것이라
제품 UI가 바뀌면 같이 낡는다. 그렇다고 제품을 조금 고칠 때마다 랜딩 QA를 전부 돌리지는
않는다. **아래 영역을 바꿨을 때만** 3문항을 확인하고 결과를 남긴다.

| 제품 변경 영역 | 랜딩에서 확인할 화면 |
|---|---|
| 주문관리(`orders/order-table.tsx`, 주문 목록 필터) | `OrdersScreen` |
| 엑셀 접수(`import/*`, 가져오기 범위) | `ImportScreen` |
| 고객관리(고객 목록·상세·동일인 후보) | `CustomersScreen` |
| 배송관리(배송그룹·기사배정·가방번호·저장 배너) | `DeliveryScreen` |
| 기사앱(`/driver`) | `DriverPhone`(배송 화면의 결과) |
| 공통 네비게이션(`lib/constants/nav.ts`) | `AppFrame` 좌측 네비 |

**확인 3문항**
1. 화면 구조가 실제 제품과 크게 달라졌는가?
2. 버튼·라벨·상태 문구가 더 이상 실제 제품과 일치하지 않는가?
3. 랜딩이 보여주는 기능 흐름이 실제 제품에서 달라졌는가?

하나라도 "예"면 **같은 커밋에서 랜딩 목업도 수정**한다. 전부 "아니오"면 커밋 메시지나
게이트 보고에 **"랜딩 영향 없음"을 한 줄로 기록**한다(확인했다는 근거를 남기는 것이 목적).
제품 내부 로직·리팩터링처럼 화면에 드러나지 않는 변경은 이 게이트 대상이 아니다.

**랜딩 예시 데이터 규칙(고정):** 사람 이름은 예외 없이 `성○이름`으로 마스킹한다. 전화번호와
상세 주소는 만들지 않는다(지역은 구 단위까지). 없는 기능·성과 수치·고객사 로고는 그리지
않는다. 개인정보가 포함된 실화면 캡처는 사용 금지(BLOCKER).

## 2. 실행 순서 (통합 회귀)

기능을 여러 영역에 걸쳐 바꿨을 때는 아래 순서로 돌린다. 앞 단계가 깨지면 뒤는 의미가 없다.

1. **정적 게이트** — `npx tsc --noEmit` → `npx eslint .` → `npx next build`
2. **정합성 스냅샷** — `qa/data-integrity-audit.ts` (RED 0 확인, 쓰기 없음)
3. **핵심 사이클** — `delivery-flow` → `step11-13-draft-batch-save` → `step12-11-delivery-ui-cleanup`
4. **영역별 게이트** — §1에서 해당되는 것 전부
5. **권한·격리** — `step12-12-permission-attack-surface` → `e2e-p3-user4-isolation`
6. **성능 기준선** — §4 (수치를 바꾼 변경일 때만)
7. **정합성 재확인** — `data-integrity-audit.ts` 재실행 후 2번과 비교(RED/YELLOW 증가 0)
8. **배포 검증** — Vercel success → HTTP 200 → 변경 화면 실제 확인

## 3. STOP 조건 (CTO 자율 진행 중단)

① 제품 정책 변경 ② 되돌릴 수 없는 데이터 변경 ③ 권한·보안 정책 변경 ④ 신규 기능·범위 확대.
그 외(QA 노후화·flaky·범위 내 제품 버그)는 CTO가 고치고 계속 진행한다.

## 4. 성능 기준선

같은 스크립트·같은 건수로만 비교한다.

| 항목 | 기준선 | 스크립트 |
|---|---|---|
| 일괄배정 150건 | Draft 897~1,054ms / 전체 3,824~3,948ms | `e2e-step11-4-b-bulk-assign-reverify.ts` |
| 개별배정 150건 보드 12회 | median 2,776~3,202ms / max 3,336~6,473ms | `perf-individual-assign.ts` |
| 저장 구간 분해 | 서버 2.0~2.3초 / 다운로드 1.0~1.3초 / 화면 14~55ms | `perf-save-cost-breakdown.ts` ([보고서](../P2-SAVE-COST/MEASUREMENT-REPORT.md)) |

## 5. 유지 규칙

- 스크립트를 추가·삭제하면 [QA-SCRIPT-INVENTORY.md](../QA-SCRIPT-INVENTORY.md)와 이 문서를 함께 갱신한다.
- 새 기능 게이트는 §1에 **행을 추가**하는 방식으로만 늘린다(문서를 새로 만들지 않는다).
