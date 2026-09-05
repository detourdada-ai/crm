# STEP15-B — 메시지 정책 & 발송 기반 구조

> 2026-09-05 / CTO. 실제 발송·API 호출·충전·가격 확정은 **하지 않았다**(작업지시 §16).
> 사전 조사는 [STEP15A-MESSAGE-FOUNDATION-SURVEY.md](./STEP15A-MESSAGE-FOUNDATION-SURVEY.md).

## 1. 이벤트 확정 — Case B (배정과 출발은 같은 전이다)

작업지시 §1은 "기사 배정과 실제 배송시작이 서로 다른 실제 액션인지" 확인하라고
했다. 코드로 확인한 결과는 **Case B**다.

| 근거 | 코드 |
|---|---|
| 배정하면 그 순간 `배송중`이 된다 | `order-shipments.repository.ts` — `assignDriver()`가 `driver_id`와 `delivery_status: "배송중"`을 함께 UPDATE |
| 배송 시작은 아직 `배송대기`인 행만 대상 | `startDelivery()`에 `.eq("delivery_status", "배송대기")` 조건 — 이미 배정된 건은 대상이 아님 |
| 기사 앱에는 배송건 단위 "출발" 액션이 없다 | 기사 액션은 운행 시작(`driver_shifts`, **하루 단위**)과 배송완료(`markDelivered`, 배송건 단위) 두 개뿐 |

그래서 배송건 단위로 "지금 출발했다"를 구분할 방법이 현재 제품에 없다.
없는 액션을 위해 이벤트를 만들면 **영원히 발송되지 않는 설정 토글**이 생기므로,
MVP 이벤트는 3개로 확정한다.

```
ORDER_RECEIVED      주문이 정상 등록됨            (배송 상태 전이가 아님)
DRIVER_ASSIGNED     기사 배정 = 배송대기 → 배송중  (배송 예정 안내)
DELIVERY_COMPLETED  배송완료
```

`DELIVERY_STARTED`는 만들지 않았다. `취소`는 작업지시 §2대로 MVP에서 제외한다.

> **참고(향후 선택지)**: 기사 단위로는 `driver_shifts.started_at`(운행 시작)이 있다.
> "오늘 배송을 시작했습니다"를 기사 단위로 보내는 것은 가능하지만, 배송건별 안내가
> 아니라 성격이 다르다 — 필요해지면 그때 별도 판단.

### 이벤트 훅 연결 상태

| 이벤트 | 훅 | 상태 |
|---|---|---|
| DRIVER_ASSIGNED | `notifyCustomerDeliveryStarted` (repository 3곳) | **연결됨** |
| DELIVERY_COMPLETED | `notifyCustomerDeliveryCompleted` (repository 4곳) | **연결됨** |
| ORDER_RECEIVED | — | **미연결** — 주문 생성 경로(import/주문 등록)에 호출부가 없다. 실제 발송을 붙이는 STEP15-C에서 함께 추가한다 |

훅이 액션이 아니라 **상태를 실제로 쓰는 repository**에 있어, 상태 변경 경로가
여러 액션으로 갈라져도 누락되지 않는다(중복 발송 방지도 같은 이유로 여기서 관리).

## 2. 발송 대상 — 수취인 우선

```
recipient_phone_snapshot  있으면 → 수취인에게
없으면                          → phone_snapshot(구매자) fallback
둘 다 없으면                     → 발송하지 않고 skipped(no_recipient_phone) 기록
```

`orders`에 이미 두 값이 다 있어 새로 수집할 것이 없다(STEP12-10 R04에서 분리 보존).
**수신처가 없다고 해서 주문·배송이 실패하지 않는다.**

## 3. 실패 격리 — 배송은 성공하고 메시지만 실패할 수 있다

```
배송 상태 변경 → DB 저장 성공 → dispatchMessageEvent()
                                   ├ 공급사 미설정 → 즉시 반환(DB 접근 0회)
                                   ├ 테넌트 OFF / 이벤트 OFF → skipped 기록
                                   ├ 수신처 없음 → skipped 기록
                                   └ 발송 → sent / failed 기록
```

- `dispatchMessageEvent()`는 **어떤 경우에도 throw하지 않는다**(전체 try/catch).
- `messageLogRepository.record()`도 throw하지 않는다 — migration 미적용 환경에서도 안전.
- **성능**: 공급사가 설정되지 않은 동안에는 설정 조회조차 하지 않아 배송 경로에
  DB 왕복이 1회도 늘지 않는다. 저장 고정비가 이미 문제인 상태(P2 계측)라 의도적으로
  이렇게 설계했다.

## 4. 저장 구조

| 대상 | 방식 | migration |
|---|---|---|
| 테넌트별 메시지 설정(사용 여부·이벤트 ON/OFF·발신프로필 상태·잔액부족 시 중지) | `app_settings`의 `message_settings:<username>` | **불필요** |
| 발송 이력 | **신규 테이블 `message_log`** | `supabase/migrations/0053_message_log.sql` |

기본값은 전부 **OFF**다. 사장님이 단가·잔액을 확인하고 명시적으로 켜기 전에는
어떤 자동 발송도 일어나지 않는다.

### `message_log` — 개인정보/비용 설계

- 전화번호 **원문을 저장하지 않는다.** `recipient_phone_masked`(010-****-5678)만 남긴다.
  원문이 필요한 순간은 발송 직전뿐이고 그 값은 `orders`에 있다. 로그 테이블을 새
  개인정보 저장소로 만들지 않는다.
- 비용은 `provider_cost` / `platform_fee` / `tenant_charge`로 **분리**한다. 지금은 전부
  null이며, 나중에 원가 변동·충전 할인·플랜 무료건수가 생겨도 스키마를 다시 바꿀 필요가 없다.
- `status`는 `pending/processing/sent/failed/skipped`. **skipped와 failed를 구분**해야
  "보낼 대상이 아니었던 것"이 실패율을 오염시키지 않는다.

## 5. 메시지 종류 — 알림과 마케팅을 구조에서 분리

`MessageKind = "delivery_notice" | "customer_notice" | "marketing"`

자동 발송이 가능한 것은 **고객의 실제 주문·배송 상태와 직접 연결된 메시지뿐**이다.
공지·마케팅은 자동 발송 경로에 연결하지 않는다(대량 발송기가 되지 않기 위한 구조적 차단).
수동 발송의 사전 확인 UI(대상 수·예상 비용·발송 후 잔액)는 실제 발송 기능과 함께 만든다.

## 6. Provider 추상화

```ts
interface MessageProvider {
  name; isConfigured(); send(request); getBalance();
}
```

구현체는 둘뿐이다 — `NoopMessageProvider`(기본값), `AligoMessageProvider`(스켈레톤, **HTTP 호출 없음**).
알리고 전용 파라미터는 구현체 안에만 있고 제품 로직은 인터페이스만 안다.

환경변수(`.env.example`에 이름만 준비, 값은 비어 있음):
`MESSAGE_PROVIDER` / `ALIGO_API_KEY` / `ALIGO_USER_ID` / `ALIGO_SENDER_KEY`

## 7. 남은 결정 (CPO/CEO)

1. **`0053_message_log.sql` 적용** — 이 저장소의 migration은 Supabase SQL Editor에서
   수동 실행하는 방식이다(README 관례). CTO는 DB 접속 정보가 없어 실행할 수 없다.
2. **알리고 사업자 모델**(A/B/C) 선택 — [ALIGO-PROVIDER-SURVEY.md](./STEP15B-ALIGO-PROVIDER-SURVEY.md)
3. **가격 구조** — 원가 대비 청구 방식. 코드/DB에 넣지 않았다.
