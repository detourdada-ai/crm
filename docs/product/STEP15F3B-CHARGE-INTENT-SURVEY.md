# STEP15-F3B — Charge Intent 구조 조사 (구현 없음)

> 2026-09-06 / CTO. **코드·DB 변경 0.** CPO 지시대로 조사만 하고 A/B/C 판단 재료를 제출한다.
> 실제 PG·결제창·충전 상품·보너스·환불·가격 숫자 전부 없음.

## 1. 현재 적용된 스키마 (실측)

| 테이블 | 확인된 컬럼 |
|---|---|
| `payments` | `amount` · `confirmed_amount` · `status` · `provider` · `provider_payment_id` · `idempotency_key` · `confirmed_at` |
| `payment_events` | `payment_id` · `provider` · `event_id` · `payload` · `processing_result` · `rejection_reason` |
| `message_wallet_transactions` | `reference_type` · `reference_id` · `message_log_id` · `idempotency_key` · `metadata` · `reason` · `created_by` |

`payments`에 `wallet_amount` / `bonus_amount` / `policy_snapshot` / `charge_intent_id`는 **없다**(확인함).

### 결정적으로 중요한 발견 하나
`message_wallet_transactions`에 이미 **범용 참조 슬롯**이 있다.

```
reference_type  text   'system' | 'message' | 'admin_adjustment' | …  (enum이 아니라 text)
reference_id    text
```

`reference_type`을 enum으로 못 박지 않은 것이 여기서 값을 한다 —
**충전 거래를 `reference_type='charge_intent'` / `reference_id=<intent id>`로 연결하는 데
기존 테이블 변경이 필요 없다.** 즉 Charge Intent를 도입해도 Wallet 쪽은 손대지 않는다.

## 2. 세 가지의 수명주기가 실제로 다른가

| | 언제 생기나 | 언제 끝나나 | 없어도 되는가 |
|---|---|---|---|
| **Payment** | 사장님이 결제창으로 갈 때 | PG가 확정/실패시킬 때 | **보상·이벤트 지급은 결제 없이 잔액을 준다** → Payment 없이 충전이 존재할 수 있다 |
| **Charge Intent** | 사장님이 "얼마 충전"을 고를 때 | 잔액이 실제 지급될 때 | 1:1 정책이면 없어도 되지만, **정책 스냅샷을 남길 곳이 사라진다** |
| **Wallet Ledger** | 잔액이 실제 움직일 때 | append-only(영구) | 필수 |

**"결제 없이 지급"이 존재할 수 있다는 점**이 A/B를 가르는 핵심이다. `payments`에 지급 정보를
넣는 순간, 결제가 없는 지급(운영 보상, 베타 크레딧, 사과 크레딧)은 표현할 방법이 없어진다.

## 3. A / B / C 비교

| 항목 | **A. `message_charge_intents` 신규** | **B. `payments` 확장** | **C. 구조 없이 F4** |
|---|---|---|---|
| 결제 없는 지급(보상·이벤트) | **표현 가능** | 불가(가짜 payment를 만들어야 함) | 불가 |
| 보너스/프로모션 | intent에 `bonus_amount` | payments에 섞임 | 불가 |
| 정책 스냅샷 | intent에 그 시점 정책 보존 | payments가 정책까지 떠안음 | 없음 |
| 부분 환불 → 부분 회수 | intent 단위로 계산 | payment 금액만으로는 회수액 산출 불가 | 불가 |
| 기존 테이블 변경 | **없음**(§1 참조 슬롯 재사용, intent가 `payment_id`를 들고 있으면 payments도 무변경) | `payments`에 컬럼 3개 추가 | 없음 |
| 조회 복잡도 | 조인 1회 증가 | 단순 | 가장 단순 |
| 지금 필요한가 | 정책이 1:1이어도 **표현력**은 미리 확보 | 1:1일 때만 충분 | 1:1을 영원히 유지할 때만 |

> CPO 지적 그대로다 — **"1:1이라는 정책"과 "1:1로밖에 표현할 수 없는 구조"는 다르다.**
> B는 후자를 만든다.

## 4. 환불·취소 확장성에서 드러나는 차이

```
10,000원 결제 → 11,000원 지급(보너스 1,000)
사장님이 전액 환불 요청
   B: payments.amount(10,000)만 있으므로 "얼마를 회수해야 하는지" 계산 근거가 없다
   A: intent가 wallet 10,000 + bonus 1,000을 들고 있어 회수액이 명확하다
```

부분 환불이면 차이가 더 커진다. 지금 환불 기능을 만들자는 게 아니라, **나중에 만들 때
과거 데이터로 계산이 되는가**가 갈린다.

### 확인된 제약 하나
현재 Wallet RPC는 `charge/reserve/capture/release/adjust`만 받는다 — **`refund` 타입은 거부**된다(실측).
환불 회수를 `adjust`(사유 필수)로 처리할지 별도 타입을 추가할지는 **F4 이후 환불 설계 시점의 결정**이고,
지금 정하지 않는다. 다만 타입 추가는 `message_wallet_transactions`의 check 제약 변경 = migration이라는 점만 기록해 둔다.

## 5. migration 필요 여부 판단

**안 A를 택할 경우 — 신규 테이블 1개, 기존 테이블 변경 0.**

```
message_charge_intents
  id · tenant_id · owner_username
  payment_amount      결제로 받을 금액(1/100원 정수)
  wallet_amount       지급할 잔액
  bonus_amount        보너스(현재 정책상 0)
  policy_snapshot     jsonb — 그 시점 단가/프로모션 조건
  payment_id          nullable → 결제 없는 지급도 표현 가능
  status              created | paid | granted | cancelled
  granted_at
  idempotency_key     unique(owner_username, idempotency_key)
```

- `payments`는 **건드리지 않는다**(intent가 payment를 가리키는 방향).
- Wallet 연결도 **기존 `reference_type='charge_intent'` + `reference_id`로 충분**하다.
- 충전 실행 시 멱등성 키는 `charge_intent_id`가 된다 — `payment_id`보다 정확하다.
  결제 없는 지급도 같은 경로를 쓰기 때문이다.

**안 B는 `payments`에 컬럼 3개 추가 = 기존 테이블 변경**이라 오히려 migration 영향이 크다.

## 6. CTO 의견 (결정은 CPO)

**A를 권한다.** 근거는 취향이 아니라 두 가지 사실이다.

1. **결제 없는 지급이 실재할 수 있다** — 베타 크레딧·운영 보상. B/C는 이걸 가짜 결제로
   위장해야 하고, 그러면 `payments`가 "돈 낸 사실"이 아니게 된다(F3에서 세운 경계가 무너진다).
2. **A가 기존 테이블을 하나도 바꾸지 않는다.** 표현력을 얻는 대가가 조인 1회뿐이다.

지금 정책이 1:1이라는 것과, 1:1만 표현 가능한 구조를 고르는 것은 다르다.

## 7. 다음 (승인 후)

A 승인 시: migration 초안(영향·확인 SQL·rollback·RLS) 제출 → 적용 → repository/QA →
그 다음에야 F4(`Charge Intent granted → wallet charge`) 연결. **F4에서도 충전 금액 정책은
코드에 넣지 않는다** — intent가 정책 스냅샷을 들고 있으므로 정책은 데이터로 들어온다.
