# STEP15-F3A — 결제 상태 전이표 (코드보다 먼저)

> 2026-09-06 / CTO. CPO 지시대로 **구현 전에 전이 규칙을 먼저 고정**한다.
> 실제 PG·결제창·충전 UI 없음. Wallet 자동 충전 없음.

## 1. 왜 전이표가 먼저인가

PG는 webhook을 **재전송**하고(토스: 2xx 아니면 최대 7회), 입금 오류처럼 **상태가 되돌아가는**
경우도 있으며, 성공 응답과 webhook의 **순서가 뒤바뀔** 수 있다. 규칙이 코드에 흩어져 있으면
"늦게 도착한 pending이 confirmed를 덮어쓰는" 사고가 난다.

## 2. 전이표

| From \ To | created | pending | confirmed | failed | cancelled | expired |
|---|---|---|---|---|---|---|
| **created** | = | ✅ | ✅ | ✅ | ✅ | ✅ |
| **pending** | ❌ | = | ✅ | ✅ | ✅ | ✅ |
| **confirmed** | ❌ | ❌ | = | ❌ | ❌ | ❌ |
| **failed** | ❌ | ❌ | ✅ | = | ❌ | ❌ |
| **cancelled** | ❌ | ❌ | ❌ | ❌ | = | ❌ |
| **expired** | ❌ | ❌ | ❌ | ❌ | ❌ | = |

`=` 는 같은 상태 재적용(멱등 no-op)이며 오류가 아니다.

### 규칙의 근거
- **confirmed는 사실상 종착점이다.** 뒤늦게 도착한 `pending` 이벤트가 확정된 결제를 되돌리면
  충전 근거가 무너진다. 되돌림(입금 오류·취소)은 **환불 흐름**으로 다뤄야 하고, 그건 F3A 범위 밖이다
  (그때 `refunded` 상태와 별도 전이가 추가된다).
- **failed → confirmed만 예외로 허용한다.** 승인 지연·재시도로 실패 판정 뒤 실제로 승인되는
  경우가 실재한다. 단 이때도 **서버 조회로 재확인 + 금액 대조**를 통과해야 한다.
- **cancelled / expired는 종결**이다. 다시 살리려면 새 결제를 만든다.

## 3. 거부된 전이는 어떻게 되나

전이가 거부돼도 **이벤트 원본은 `payment_events`에 그대로 남는다.** 처리 결과를
`rejected`로 기록하고 사유를 남긴다 — "무시했다"와 "받은 적 없다"는 다르다.

## 4. 멱등성 — DB가 최종 방어선

| 제약 | 막는 사고 |
|---|---|
| `unique(owner_username, idempotency_key)` | 같은 충전 요청이 결제 두 건으로 갈라짐 |
| `unique(provider, provider_payment_id)` | 같은 PG 결제가 우리 쪽에서 두 건이 됨 |
| `unique(provider, event_id)` | **webhook 재전송(최대 7회)** 이 중복 처리됨 |

애플리케이션 검사만으로는 동시 요청을 닫을 수 없다 — Wallet(0055)에서 쓴 방식과 같다.

## 5. `amount`의 의미 — 하나로 고정

`payments.amount` = **PG에 결제를 요청한 금액(승인되어야 할 금액)**, 단위는 Wallet과 같은
**1/100원 정수**(10,000원 = `1,000,000`). 할인·수수료가 생기면 그건 별도 컬럼이지
이 값의 의미를 바꾸지 않는다. `confirmed_amount`는 **PG가 실제로 승인했다고 알려준 금액**이며,
두 값이 다르면 `confirmed`로 올리지 않는다(금액 불일치 차단).

## 6. Wallet과의 경계 (F3A에서 연결하지 않음)

```
Payment.confirmed
      ↓  (F4에서 구현할 별도 단계)
충전 가능 여부 검증
      ↓
message_wallet_apply_transaction('charge', idempotencyKey = payment_id)
```

**webhook에서 Wallet을 직접 늘리지 않는다.** 충전 시 멱등성 키는 `payment_id`로 고정해,
같은 결제로 두 번 충전되는 것을 **Wallet의 DB 제약이 다시 막게** 한다.
