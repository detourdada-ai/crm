# STEP15-F3D-2 STEP 1 — 사전 조사 (코드·DB 변경 0)

> 2026-09-06 / CTO. 지시하신 7개 항목만 실측한다. DDL·migration·구현은 STEP 2 승인 후.
> 실제 결제 0 / 실제 발송 0 / 가격 숫자 0.

---

## 1. 현재 마지막 migration 번호

```
0055_message_wallet.sql
0056_message_wallet_cascade_fix.sql
0057_payments.sql
0058_message_charge_intents.sql
0059_charge_intent_guard_fk_fix.sql   ← 마지막
```

**→ 다음 번호는 `0060`.** (가정하지 않고 파일 목록으로 확인함)

## 2. `message_log`의 실제 PK / FK

```sql
id          uuid primary key default gen_random_uuid()
tenant_id   uuid not null references tenants (id)          on delete cascade
order_id    uuid          references orders (id)           on delete set null
shipment_id uuid          references order_shipments (id)  on delete set null
```

**`message_log`를 참조하는 쪽**
```sql
message_wallet_transactions.message_log_id uuid references message_log (id) on delete set null
```

→ **PK는 uuid**이므로 `price_policy_id`도 uuid FK로 붙이면 타입 충돌이 없다.
→ 이미 `on delete set null` 참조가 하나 있고, **0056에서 이 경로가 append-only 트리거와 충돌**했던 이력이 있다(그때 고침). 새 FK를 추가할 때 같은 함정을 다시 확인해야 한다.

## 3. RLS 관례

- 모든 돈 관련 테이블: `enable row level security` + **정책 0개**(service_role 전용).
- 실측으로 검증된 상태: anon 키로 `message_log` / `payments` / `payment_events` /
  `message_wallet*` / `message_charge_intents` **조회·삽입 차단**, 지갑·지급 **RPC 직접 호출도 차단**
  (`step15f2-wallet-access-control` 14/14).
- **→ 신규 `message_pricing_policies`도 동일 적용**(정책 0개), 그리고 QA에 조회/삽입/수정/삭제 + 신규 RPC 항목 추가.

## 4. `message_log` 생성·수정 경로 (전수)

| 경로 | 용도 |
|---|---|
| `message-log.repository.ts` — `insert` | 생성(pending/skipped) |
| `message-log.repository.ts` — `update` | 결과 반영(`markResult`) |
| `message-log.repository.ts` — `select` | 발송 내역 조회 |
| `dispatch.ts` — `select`(1곳) | **중복 판정 조회 전용**(`alreadyAttempted`) |

**쓰기는 repository 한 곳뿐이다.** → `price_policy_id` 기록도 그 안에서만 하면 되고, 다른 경로가
우회로가 될 위험이 없다.

## 5. `tenant_charge`가 확정되는 정확한 위치

`src/lib/services/messaging/dispatch.ts`

```
158  const unitPrice = (options?.pricing ?? getPricingPolicy()).getUnitPrice("delivery_notice", "alimtalk");
159  if (unitPrice === null) → skipped(PRICE_NOT_CONFIGURED)   ← 여기서 발송·차감 전부 중단
174  reserve  amount = unitPrice
212  capture/release amount = unitPrice
226  markResult(tenantCharge = 성공 시 unitPrice)
```

**→ 단가가 결정되는 지점은 158번 한 줄뿐이다.** 여기서 정책 객체(단가 + 정책 id)를 함께 돌려주게
바꾸면, reserve/capture/log까지 같은 값이 자연스럽게 흐른다. **분기 추가가 필요 없다.**

## 6. tenant / provider / message_type의 실제 값

| 축 | 현재 실제 값 | 형태 |
|---|---|---|
| tenant | `owner_username`(= `tenants.slug`) | **text, enum 아님** |
| provider | `provider.name` — 현재 `noop`, 향후 `aligo` | **text, 제약 없음**(`message_log.provider` 기본값 `'noop'`) |
| message_type | `alimtalk` / `sms` / `lms` | **check 제약 있음**(`message_log.message_type`) |
| 호출 인자 | `getUnitPrice(kind, channel)` — `kind`는 `delivery_notice/customer_notice/marketing` | 코드 타입 |

**주의 1**: dispatch는 현재 `channel`을 `"alimtalk"`로 **하드코딩**한다(129·195행). 정책 조회 축을
`message_type`으로 잡으면 지금은 항상 alimtalk 하나로만 매칭된다 — 구조상 문제는 없지만
"채널 선택"이 생기는 시점에 이 하드코딩을 함께 풀어야 한다.

**주의 2**: `kind`(정보성/공지/마케팅)와 `message_type`(알림톡/SMS/LMS)은 **다른 축**이다.
가격은 실제로 둘 다에 영향받을 수 있다(마케팅=친구톡 단가). 정책 키에 `kind`를 넣을지는
STEP 2 결정 사항으로 올린다.

## 7. 기존 FK 삭제·정리 경로 (트리거 함정 재발 방지용)

| 삭제 대상 | 연쇄 동작 | 지금까지의 사고 |
|---|---|---|
| `orders` 삭제 | `message_log.order_id → null` | — |
| `order_shipments` 삭제 | `message_log.shipment_id → null` | — |
| `message_log` 삭제 | `message_wallet_transactions.message_log_id → null` | **0055 트리거가 이 UPDATE를 막아 로그 삭제가 실패**했다 → 0056에서 `pg_trigger_depth()`로 해결 |
| `payments` 삭제 | `message_charge_intents.payment_id → null` | **0058 트리거가 막아 결제 삭제가 실패**했다 → 0059에서 동일 방식으로 해결 |
| `tenants` 삭제 | 전부 cascade | — |

> **패턴이 두 번 반복됐다.** 보호 트리거를 만들 때마다 "FK가 유발한 UPDATE"를 빠뜨렸다.
> **STEP 2 DDL에는 처음부터 `pg_trigger_depth() > 1` 통과 조건을 넣고, QA에도 FK 정리 항목을
> 필수로 포함한다.** 이번에는 만들고 나서 고치지 않는다.

---

## STEP 2에서 결정해서 올릴 항목 (미리 정리)

1. **정책 키 축** — `(owner_username | null) × message_type × provider` + `kind` 포함 여부
2. **active 중복 방지 방식** — 부분 unique 인덱스 vs `effective_from/to` 범위 배제(`exclude` 제약)
3. **fallback 규칙 구현 위치** — resolver(앱) 단독 vs DB 뷰/함수
4. **가격 보호 트리거 조건** — 잠글 컬럼 목록 + `pg_trigger_depth()` 예외
5. **`message_log.price_policy_id` FK 삭제 정책** — `on delete restrict`(정책을 지우지 못하게) vs
   `set null`(증빙이 사라짐) → **restrict 쪽이 증빙 보존에 맞다**는 것이 현재 판단
6. rollback / RLS / 인덱스

## 확인 사항

- 코드·DB **변경 0**, 실제 결제 0, 실제 발송 0, 잔여 데이터 0(현재 모든 돈 관련 테이블 0행).
- 운영용 가격 정책은 **seed하지 않는다**. "설정된 가격 정책 없음"이 정상 상태다.
