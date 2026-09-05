# STEP15-A STEP A — 메시지 기반 구조 사전 조사 (읽기 전용)

> 2026-09-05 / CTO. **코드·DB 변경 0.** CPO 지시(STEP A)에 따라 현재 코드에 무엇이
> 이미 있고 무엇이 없는지만 확인했다. 설계·구현·migration은 이 보고 이후에 한다.

## 1. 배송 상태 — 실제로 존재하는 값은 4개뿐

`src/types/domain.ts:129`

```ts
export type DeliveryStatus = "배송대기" | "배송중" | "완료" | "취소";
```

작업지시서의 이벤트 후보를 실제 상태에 대보면 **3개가 어긋난다.**

| 지시서 후보 | 실제 제품 | 판정 |
|---|---|---|
| `ORDER_RECEIVED` (배송준비) | **"배송준비" 상태는 없다.** 주문 등록 시 배송건은 `배송대기`로 생성된다 | 배송 상태 전이가 아니라 **주문 생성 시점** 이벤트로 다뤄야 함 |
| `DRIVER_ASSIGNED` | 기사 배정 시 `배송대기 → 배송중`으로 함께 바뀐다(`assignDriver`) | 존재하나 **상태 전이가 배정과 붙어 있음** |
| `DELIVERY_STARTED` | `startDelivery` → `배송중` | 존재 |
| `DELIVERY_IN_PROGRESS` | 위와 **같은 상태(`배송중`)** | **별도 이벤트 아님 — 합쳐야 함** |
| `DELIVERY_COMPLETED` | `완료` + `completed_at` | 존재 |

**없는 상태를 메시지 때문에 새로 만들지 않는다**는 원칙에 따라, 실제 이벤트는 최대 4개다.

```
ORDER_RECEIVED     주문 등록(엑셀 접수·직접 등록) — 배송 상태 아님
DRIVER_ASSIGNED    기사 배정(= 배송대기 → 배송중)
DELIVERY_STARTED   배송 시작(= 배송대기 → 배송중, 배정과 별개 경로)
DELIVERY_COMPLETED 배송완료
```

`DRIVER_ASSIGNED`와 `DELIVERY_STARTED`는 **도착 상태가 같다**. 고객에게 두 번 보내면
중복 알림이 되므로, 둘을 하나로 볼지 배정/출발을 구분할지는 **CPO 판단 사항**이다.
`취소`는 후보에 없었지만 실제 상태로 존재한다(알림 대상 여부도 판단 필요).

## 2. 이벤트 지점은 **이미 있다** — 새로 만들 필요 없음

`src/lib/services/customer-notification.service.ts` (S2-C STEP4에서 선반영)

```ts
export async function notifyCustomerDeliveryStarted(_orderId, _shipmentId) { /* no-op */ }
export async function notifyCustomerDeliveryCompleted(_orderId, _shipmentId) { /* no-op */ }
```

`order-shipments.repository.ts`에서 **7곳이 이미 이 훅을 호출**한다(배송시작 3 / 배송완료 4).
액션이 아니라 **repository(상태를 실제로 쓰는 지점)** 에 붙어 있어, 액션이 6개로 갈라져도
누락되지 않는다 — 위치 선택은 지금 구조 그대로 두는 것이 맞다.

**빠져 있는 훅**: 기사 배정(`assignDriver`), 주문 등록(`import.service` / 주문 생성).

### ⚠ 지금 구조의 위험 (구현 시점에 반드시 처리)

훅이 `await`으로 호출된다.

```ts
await Promise.all((data ?? []).map((s) => notifyCustomerDeliveryCompleted(s.order_id, s.id)));
```

지금은 no-op이라 무해하지만, 여기에 외부 API를 그대로 넣으면 **알림톡 장애가 배송완료
실패로 전파된다.** CPO가 못 박은 "메시지 실패가 업무 실패가 되면 안 된다"를 지키려면
구현 시 이 호출을 **실패 흡수(try/catch) + 결과를 기록만** 하는 형태로 감싸야 한다.
현재 코드에는 그 격리가 없다.

## 3. 수신자 연락처 — 이미 있다

| 출처 | 필드 | 비고 |
|---|---|---|
| 주문 | `orders.phone_snapshot` | 구매자 우선 → 수취인 순으로 계산된 값(STEP12-10 R04) |
| 주문 | `orders.buyer_phone_snapshot` | 원본 보존값 |
| 고객 | `customers.phone` | `010-1234-1234` 정규화 |

발송 대상 번호를 새로 수집할 필요는 없다. 다만 **누구에게 보낼지(구매자 vs 수취인)** 는
정책 판단이다 — 선물 주문이면 둘이 다르다.

## 4. Admin 메뉴 구조 — 플래그는 있고, 쓰는 항목이 0개

- `NavItem.adminOnly?: boolean`이 타입에 있고 `nav-links.tsx`가 이미 필터링한다
  (`.filter((item) => !item.adminOnly || isAdmin)`).
- 그런데 **`NAV_ENTRIES`에 `adminOnly: true`인 항목이 하나도 없다.** 현재 admin 전용 기능은
  전부 `/settings` 안의 조건부 섹션(`session.role === "admin"`)으로만 존재한다.
- 따라서 상단 좌측 네비게이션에 **admin 전용 "메시지 관리" 항목을 추가하는 것은 구조 변경 없이 가능**하다(플래그만 켜면 됨).

## 5. 설정 저장 — 재사용 가능한 것과 불가능한 것

| 저장 대상 | 재사용 가능? | 근거 |
|---|---|---|
| 테넌트별 메시지 사용 여부·발신 프로필 상태 등 **설정값** | **가능** | `app_settings(key, value JSONB)` + 계정별 네임스페이스 키 선례 4건(`vip.service`, `column-view-settings`, `import_column_mapping`, `import_order_scope`) |
| 테넌트 기능 ON/OFF를 **컬럼**으로 둘 경우 | 불가(migration) | 선례는 `tenants.bag_management` 컬럼 — 새 컬럼은 스키마 변경 |
| **메시지 발송 로그** | **불가 — 신규 테이블 필요** | 기존 로그성 테이블은 `customer_change_logs`(고객 변경 이력), `merge_history`(병합), `imports`(업로드 이력)뿐. 의미·스키마가 전혀 다르다. `app_settings`에 누적하는 것은 용량·조회·정합성 모두 부적합 |

## 6. 결론 / 다음 단계 판단 재료

**이미 있는 것** — 배송 상태 4종, 상태 write choke point(repository), 알림 훅 2개와 호출부 7곳, 수신자 연락처, admin 전용 메뉴 플래그, 테넌트별 설정 저장소(app_settings).

**없는 것** — 기사 배정·주문 등록 이벤트 훅, 메시지 실패 격리, 공급사(Provider) 추상화, 템플릿·잔액·발송 로그 구조.

**BLOCKER(승인 전 실행 금지)**
1. **`message_log` 신규 테이블 = DB migration.** 기존 구조 재사용 불가로 확인됨. 영향 범위·rollback·RLS 검토 후 승인 필요.
2. **이벤트 정의 확정**: `DRIVER_ASSIGNED`와 `DELIVERY_STARTED`가 같은 상태(`배송중`)로 수렴하는 문제, `ORDER_RECEIVED`가 배송 상태가 아니라는 점, `취소` 알림 여부 — 제품 정책 판단.
3. **발송 대상**(구매자 vs 수취인) 정책 판단.

**승인 없이 가능한 범위** — 위 3개가 정해지기 전까지도 가능한 것은 Provider 인터페이스 설계와
admin `메시지 관리 [SOON]` 정보 구조다. 단 SOON 화면의 자동 알림 목록은 §1의 실제 이벤트와
일치해야 하므로, **이벤트 정의가 확정된 뒤에 만드는 것이 맞다**(지금 만들면 "배송준비"처럼
존재하지 않는 상태를 화면에 그리게 된다).
