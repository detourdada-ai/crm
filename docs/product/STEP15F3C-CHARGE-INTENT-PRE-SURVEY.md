# STEP15-F3C 사전 조사 — Charge Intent 저장소 / grant 원자성 (구현 없음)

> 2026-09-06 / CTO. **코드·DB 변경 0.** CPO 지시 4가지(스키마 재확인 / `unique(payment_id)` 영향 /
> grant 원자성 방식 / migration 영향·rollback·RLS)를 조사만 하고 승인 전까지 구현하지 않는다.

## 1. 실제 적용된 스키마 재확인 (실측)

| 테이블 | 결과 |
|---|---|
| `payments` | `id · tenant_id · owner_username · amount · confirmed_amount · status · provider · provider_payment_id · idempotency_key · created_at · updated_at · confirmed_at` **전부 존재** |
| `message_wallet` | `id · tenant_id · owner_username · available_balance · reserved_balance · amount_unit` **전부 존재** |
| `message_wallet_transactions` | `wallet_id · owner_username · type · amount · reference_type · reference_id · message_log_id · idempotency_key · created_by · reason · metadata · available_after · reserved_after` **전부 존재** |
| `message_charge_intents` | **없음**(신설 대상) |

### 확인한 동작 두 가지 (설계 판단의 근거)

1. **기존 Wallet RPC는 실패 시 예외를 던진다.** 잔액 없는 `reserve` → `insufficient_balance` 예외.
   → 다른 함수가 이 RPC를 **내부 호출**하면, 실패가 **호출자 트랜잭션까지 되돌린다.**
2. **`reference_type`은 자유 문자열이다.** `charge_intent` / `probe`로 넣고 그대로 기록되는 것을 확인했다.
   → **기존 테이블 변경 없이** 충전 거래를 Intent에 연결할 수 있다.

## 2. `unique(payment_id)` — A / B 비교와 **제3안**

| | A 강제 unique | B FK만 + 앱 정책 |
|---|---|---|
| 같은 결제로 두 번 지급 | **DB가 차단** | 앱 버그 시 통과 |
| 미래 부분지급·재처리 | 막힘 | 자유 |
| 사고 심각도 | 낮음 | **높음**(돈을 두 번 줌) |

CPO 권고대로 **A가 맞다**. 다만 조사하면서 A의 부작용이 하나 보였다.

> 나중에 **환불 회수(clawback)** 나 **보정 지급**을 만들 때, 그 Intent도 같은 결제를
> 가리키고 싶어진다. 그런데 `unique(payment_id)`면 두 번째 Intent를 만들 수 없다.

### 제안 — **부분 unique로 좁힌다**
```sql
unique (payment_id) where payment_id is not null and kind = 'payment'
```
- **결제 1건 → 충전 Intent 1건**은 DB가 강제한다(원래 목적 달성).
- 미래의 `clawback` / `compensation` Intent는 같은 결제를 참조해도 제약에 걸리지 않는다.
- 지금 clawback을 만들자는 게 아니라, **A를 택하면서 미래를 막지 않는 형태**를 고른 것이다.

## 3. grant 원자성 — **전용 RPC(안 A) 권고**, 단 기존 RPC를 재사용

핵심 발견: **plpgsql 함수는 다른 함수를 호출해도 같은 트랜잭션**이다. 따라서 전용 RPC가
Wallet 로직을 복사할 필요가 없다.

```
message_charge_intent_grant(p_intent_id, p_performed_by)
  ├ select intent ... for update          -- 동시 grant 직렬화
  ├ 상태 검증 (created/pending 만 허용)
  ├ kind='payment'이면 payments.status='confirmed' 확인   ← 여기서 STOP 3 방지
  ├ message_wallet_apply_transaction('charge', reference_type='charge_intent',
  │                                  idempotency_key = intent_id)   ← 기존 RPC 재사용
  └ intent.status='granted', granted_at, granted_by
```

- Wallet RPC가 실패하면 **예외가 전파되어 intent 업데이트까지 롤백**된다(§1-1에서 확인).
  → "잔액은 늘었는데 intent는 pending" 같은 반쪽 상태가 원천적으로 안 생긴다.
- 반대로 intent 업데이트가 실패해도 같은 트랜잭션이라 **잔액도 함께 롤백**된다.
- 멱등성은 두 겹이다: `for update` 잠금 + Wallet의 `unique(wallet_id, type, idempotency_key)`.
  grant를 10번 불러도 charge는 1건이다.

**안 B(앱에서 두 번 호출)를 배제하는 이유**는 CPO가 든 시나리오 그대로다 — Wallet charge 성공
직후 프로세스가 죽으면 intent가 pending으로 남고, 재시도 때 "이미 충전됐는지"를 앱이 판단해야
한다. 지금 Wallet 멱등성이 그 사고를 막아주긴 하지만, **판단 자체를 앱에 두지 않는 것**이 낫다.

### 예외로 남겨둘 것
`Payment.confirmed`인데 grant가 실패하는 경우(잔액 로직 오류 등)는 **intent가 granted가 아닌
상태로 남아야 한다** — CPO 지시대로 자동으로 숨기지 않는다. 운영자가 "돈은 받았는데 크레딧이
안 나간 건"을 조회할 수 있도록 상태 그대로 둔다.

## 4. Migration 초안 — 영향 / rollback / RLS

**신규 1테이블 + 신규 1함수. 기존 테이블·함수 변경 0.**

```
message_charge_intents
  id · tenant_id · owner_username
  kind            payment | admin_grant | promotion | compensation
  status          created | pending | granted | cancelled | failed | expired
  wallet_amount   bigint >= 0        지급할 잔액
  bonus_amount    bigint >= 0        보너스(현재 정책상 0)
  total_amount    bigint >  0        check (total = wallet + bonus)
  amount_unit     text default 'KRW_CENTI'
  payment_id      uuid null references payments(id)
  policy_snapshot jsonb null         그 시점 정책 보존
  reason          text null          운영 지급 사유
  granted_at · granted_by · created_at · updated_at
  idempotency_key text  unique(owner_username, idempotency_key)
```

| 항목 | 내용 |
|---|---|
| 영향 범위 | 기존 스키마 변경 없음. `payments`를 FK로 **참조만** 한다(참조당하지 않음) |
| 적용 전 확인 | `select to_regclass('public.message_charge_intents');` → null |
| rollback | `drop function if exists message_charge_intent_grant(...); drop table if exists message_charge_intents;` |
| RLS | 기존 관례대로 `enable row level security` + 정책 0개(service_role 전용). **anon이 grant RPC를 직접 못 부르는지** QA에서 실측한다(지갑 RPC로 이미 검증된 방식) |
| 제약 | `total_amount = wallet_amount + bonus_amount` DB 강제 · 금액 부호 검사 · `unique(owner, idempotency_key)` · §2의 부분 unique |

### append-only가 아니다 (의도)
Charge Intent는 원장이 아니라 **상태를 가진 계약**이라 UPDATE가 필요하다. 다만 **금액과 소유자는
바뀌면 안 된다.** 트리거로 전부 막기보다, `granted` 이후 금액·`payment_id`·`owner_username`
변경을 막는 **부분 트리거**를 두는 방향을 제안한다(0055에서 트리거를 과하게 걸었다가 FK 정리까지
막았던 실수를 반복하지 않도록, 조건을 좁혀서).

## 5. STOP 판정

| | 상태 |
|---|---|
| STOP 1 기존 스키마 변경 필요 | **미발생** — `reference_type` 자유 문자열 덕분에 Wallet 무변경 |
| STOP 2 원자성 확보 불가 | **미발생** — 전용 RPC가 기존 RPC를 내부 호출하면 한 트랜잭션 |
| STOP 3 상태 정의 충돌 | **미발생** — `Payment.confirmed ≠ Intent.granted`를 그대로 유지, grant가 payment 상태를 **읽기만** 한다 |
| STOP 4 실제 PG 필요 | 미발생 |
| STOP 5 가격 하드코딩 필요 | **미발생** — 금액은 호출자가 넘기는 값이라 QA fixture로 충분하다 |

## 6. 승인 요청

1. `message_charge_intents` + `message_charge_intent_grant()` migration (§4)
2. `unique(payment_id) where kind='payment'` 형태로 §2 제안 채택 여부
3. 승인되면 구현 → migration 적용 요청 → QA(생성/Payment 연결/멱등성/장애/정합성/보안) → 보고
