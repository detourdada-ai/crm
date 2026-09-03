# Sprint S13 — 안정화·데이터·QA 통합 정리 (CTO 보고서)

- 일자: 2026-09-03
- 지시: CPO 작업지시서 「Sprint S13」
- 앱 코드(`src/`) 변경: **0건** — 이번 스프린트는 데이터 실사·QA 자산 품질·문서화만 다뤘다.

---

## 1. 데이터 조사 (PHASE 1)

Production 읽기 전용 실사. `user1`/`user2`는 조회조차 하지 않았다.

```
USER4/5 DATA AUDIT

user4
- orders:      215
- shipments:   480
- customers:   199  (전원 실명 + 실전화 010-XXXX-XXXX 보유)
- order_items: 486
- imports:       3  (주문한장_주문템플릿.xlsx / 스마트스토어_오늘분.xlsx / 스마트스토어_전체.xlsx)
- drivers/delivery_groups/settlements: 0
- 정상 관계:   215개 주문 전부가 shipment 1개 이상 보유, 모든 shipment가 실재 주문에 연결
- orphan:      0
- duplicate:   0  (동일 (order_id, delivery_date) 조합 중복 0건)
- 실제 업무 데이터 여부: 예 — 실명·실전화·실제 스토어 export 파일 근거

user5
- orders:      116
- shipments:   116
- customers:   116  (전원 실명 + 실전화 보유)
- order_items: 118
- imports:       3  (스마트스토어_전체주문발주발송관리_20260831_0731.xlsx 포함)
- 정상 관계:   1주문 : 1배송 (분할 없음)
- orphan:      0
- duplicate:   0
- 실제 업무 데이터 여부: 예 — user4와 동일 인물(지용배·박혜윤·권란영 등)이 다수 겹침,
                        같은 원본 엑셀을 두 테넌트에 각각 올린 흔적

user3
- QA 잔존 163건 → S13 이전 단계에서 전량 정리 완료(잔존 0, orphan 0)
```

**생성 경위 판정**: `user4`/`user5` 데이터는 QA 스크립트 산물이 **아니다**.
QA 스크립트는 `p4-stress-{RUN_TAG}.xlsx`처럼 RUN_TAG가 들어간 파일만 생성하고
고객명에 `QA-` 접두사를 강제하는데(`scripts/qa/lib/qa-config.ts`), 이 데이터는 둘 다
해당하지 않는다. `created_at`이 각각 `2026-08-31 08:12`, `08:57` 한 분 안에 몰려 있어
**사람이 화면에서 실제 엑셀을 업로드한 1회 세션**으로 판단된다.

## 2. `user4` shipment 480 vs orders 215

- **원인**: 데이터 모델상 **1 상품주문(order_item) → 1 배송건(order_shipment)** 이며,
  발송일이 서로 다른 상품주문은 각각 별도 배송건으로 쪼개진다.
  근거: `src/lib/services/order-shipment-sync.service.ts` 주석
  ("한 주문이 배송건 여러 개로 쪼개진 경우(발송일이 서로 다른 상품주문들)")
  + 실측 — 215개 주문 중 211개에서 `order_items 수 == shipments 수`가 정확히 일치.
  나머지 4건은 같은 발송일 상품이 하나의 배송건으로 합쳐진 경우다.
- **분포**: shipment 1개 88주문 / 2개 56 / 3개 35 / 4개 10 / 5개 24 / 6개 1 / 9개 1
- **정상/비정상**: **정상**. 재배송·중복 생성이 아니라 설계된 1:N 분할배송이다.
- **orphan**: 0건 (주문 없는 배송건 0, 배송건 없는 주문 0)
- **duplicate**: 0건 (동일 주문+동일 배송일 중복 0)
- **조치**: 없음(정상 구조). 삭제하지 않는다.

## 3. QA 데이터 정책 (PHASE 2)

- 신규 문서: [QA-DATA-POLICY.md](../QA-DATA-POLICY.md)
  - 최우선 원칙: *"실제 기존 데이터와 구분되지 않는 데이터는 QA 데이터라고 추정해서 삭제하지 않는다."*
  - 테넌트 구분표, QA 식별 규칙(접두사 + RUN_TAG), 🟢/🟡/🔴 삭제 판정 기준,
    FK 역순 삭제 절차, 스냅샷 의무를 명문화.
  - **새 DB 컬럼 없이** 기존 구조(이름의 RUN_TAG + `created_at` + `owner_username`)만으로
    tenant / scenario / created_at / qa_identifier 4가지를 역추적 가능하게 정리.
- 신규 문서: [QA-SCRIPT-INVENTORY.md](../QA-SCRIPT-INVENTORY.md)
  - 저장소 QA 스크립트 전체(상시 회귀 15 / Gate별 38 / 공통 lib 4 / 조사 7)의
    존재 이유·검증 대상·재실행 명령을 목록화.

## 4. QA 스크립트 품질 (PHASE 3)

`41925f4`로 저장소에 편입한 QA 스크립트에서 발견된 ESLint error 15 / warning 12를 전부 해소.

| 파일 | 수정 내용 |
|---|---|
| `e2e-final-cpo-test-ready.ts` | `as any` 2건 → 타입 안전한 `recipientOf()` 접근자 |
| `e2e-p2-scenario-gh-driver-cycle.ts` | `as any` 9건 → 동일 접근자 |
| `e2e-p2-driver-creation.ts` | `catch (e: any)` → `e instanceof Error` 분기 |
| `e2e-step11-1a1-orphan-customer-rootcause.ts` | `any[]` → `Awaited<ReturnType<typeof runCase>>[]` |
| `e2e-p2-scenario-c-crud.ts`, `e2e-p2-scenario-i-settlement.ts` | `let` → `const` |
| `e2e-p2-scenario-a-smartstore-excel.ts`, `e2e-p2-scenario-e-groups.ts`, `e2e-step11-1b2-filter-performance.ts`, `step12-8f-phase4-r10-r11-dnd.ts`, `step12-8g-r14-18-verification.ts`, `step11-10a-*.ts`, `step11-8-*.ts` | 미사용 변수/함수/import 제거 |
| `eslint.config.mjs` | `_` 접두사 = 의도적 미사용이라는 기존 관례를 규칙으로 승격(`argsIgnorePattern: "^_"`) — 파일별 `eslint-disable` 남발 대신 |

`eslint-disable` 신규 추가 **0건**. QA 동작을 바꾸는 수정 없음(타입/미사용 정리만).

## 5. STEP12-16B (PHASE 4)

`step12-11-delivery-ui-cleanup.ts`에 STEP12-16B 전용 회귀 4건을 **영구 추가**했다
(기존엔 임시 스크립트로 1회 확인 후 삭제 → 재현 불가 상태였다).

| 항목 | 결과 |
|---|---|
| R16B-1. 배송중 탭에서도 지도 기본 접힘 유지 | PASS |
| R16B-2. 지도 접힌 상태에서도 기사별 필터(Route패널) 즉시 노출 | PASS |
| R16B-3. Route패널에서 기사 선택 → 해당 기사로 좁혀짐 | PASS |
| R16B-4. 배정필요 탭에는 Route패널 없음(회귀 없음) | PASS |

## 6. 회귀 (PHASE 5)

`src/` 무변경이므로 회귀면은 QA 스크립트에 한정된다. 그럼에도 배송 UI 전체 회귀를
Production에서 **총 12회** 반복 실행했다.

| 항목 | 결과 |
|---|---|
| R21 상단 집계 / R22 지도 접힘 / R24 그룹 들여쓰기 / R25 연락처 | PASS |
| R23 그룹 D&D (배정필요) — 드래그·저장·새로고침 유지 | PASS (12/12) |
| R23 모바일 390px 드래그 손잡이 | PASS |
| R26 기사앱 배송메모 위치 | PASS |
| R16B-1~4 (STEP12-16B) | PASS |
| **R23-행 배송중 개별 D&D 순서 영구 반영** | **간헐 실패 — §8 참조** |

### 발견 1 — R21 산발 실패(수정 완료)
`waitForNonEmptyMainText()`가 Next.js `loading.tsx` 스켈레톤 텍스트를 "본문"으로
읽어 스트리밍 완료 전에 판정하고 있었다. 집계줄 마커를 기다리도록 교체 → 이후 12/12 PASS.
**제품 결함 아님(테스트 결함).**

### 발견 2 — 배송중 개별 D&D 저장 간헐 미반영(원인 미확정)
아래 §8.

## 7. Production

- commit: (이 보고서를 포함한 커밋 해시는 커밋 메시지 참조)
- 배포 대상 코드 변경 없음(`src/` 무변경) — 기능 동작에 영향 없음
- Production HTTP 200 정상

## 8. 남은 위험

### 🔴 즉시 판단 필요 — 배송중 개별 배송순서 저장 간헐 미반영
- **증상**: 배송중 탭에서 배송카드를 드래그해 순서를 바꾸고 "변경사항 저장"을 눌러도
  `order_shipments.route_order`가 바뀌지 않는 경우가 있다.
- **재현율**: Production 12회 실행 중 **4회 실패 / 8회 성공**(약 33%). 실패 4회는 특정
  시간대(12:50~13:05)에 연속 발생했고, 이후 5회 연속 성공.
- **확정된 사실**:
  - 드래그 자체는 정상 — 저장 전 화면 순서가 실제로 뒤바뀜(R23-행-1a 항상 PASS)
  - "변경사항 N건" 배너 정상 노출
  - 성공 시 토스트는 `"2건 저장했습니다."`
  - 실패 시 `route_order`를 **20초 동안 폴링해도 변경 없음**(R1=1, R2=2 고정)
    → 화면 렌더 지연/복제 지연이 아니라 **저장 자체가 반영되지 않은 것**
- **미확정**: 실패 시 토스트 내용(진단 코드를 넣기 전에 발생한 실패라 미포착).
  `delivery-board.tsx:261`의 `hasRowOrderChange = rowOrderDraft !== null && rowOrderChangeCount > 0`
  에서 `rowOrderChangeCount`가 0으로 계산되어 `reorderShipmentsAction`이 호출조차 되지 않는
  경로가 유력 가설이나 **미검증**.
- **조치**: QA 스크립트에 DB 수준 검증(R23-행-2a)과 토스트 캡처를 영구 추가해
  다음 재현 시 원인이 바로 남도록 했다. 코드 수정은 원인 미확정 상태라 하지 않았다.
- **CEO 테스트 영향**: CEO 테스트 A(배송중 순서 변경)에서 "순서가 저장 안 되는" 현상을
  겪을 수 있다. §9 참조.

### 🟡 보류 — user4/user5 실명·실전화 315명분 PII
- QA 테넌트에 실제 고객 개인정보가 상주 중. 삭제/이관/보존 판단은 CPO 몫(임의 삭제 금지).

## 9. 다음 Sprint 후보

1. **배송중 D&D 저장 미반영 원인 확정** (§8, 최우선)
2. user4/user5 PII 처리 방향 결정 및 실행
3. STEP12-8 전체 통합 QA + 최종보고서
4. STEP12-10 v3 Phase3/Phase4
5. STEP11-2-F1 Admin 지오코딩 backfill tenant scope
