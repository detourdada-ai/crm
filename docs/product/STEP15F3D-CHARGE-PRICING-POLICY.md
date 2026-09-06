# STEP15-F3D — 충전·가격·정산 정책 Foundation (설계 보고서)

> 2026-09-06 / CTO. **코드·DB 변경 0.** 숫자는 어디에도 넣지 않았다.
> 목적은 "결제 기능 구현"이 아니라 **나중에 돈을 받아도 구조를 다시 뜯지 않도록 정책을 고정**하는 것.

---

## ① 가격/충전 정책 맵

```
[충전 정책]                                   [메시지 가격 정책]   ← 서로 다른 정책. 하나의 price로 합치지 않는다.
   상품/금액 결정                                 event/channel별 단가 결정
        │                                                │
        ▼                                                │
   payments            ① payment_amount                  │
   (외부 결제 사실)      ⑥ payment_fee  ⑦ VAT             │
        │                                                │
        ▼                                                │
   message_charge_intents                                │
   (무엇을 왜 지급하는가)  ② wallet_amount ③ bonus_amount  │
                          policy_snapshot                 │
        │                                                │
        ▼                                                ▼
   message_wallet ── reserve ──▶ Provider 발송 ──▶ capture / release
   (실제 잔액)                     ④ provider_cost  ⑤ tenant_charge
        │                                                │
        ▼                                                ▼
   message_wallet_transactions (원장)          message_log (건별 비용 스냅샷)
        │
        ▼
   ⑧ refundable_amount ← 환불 가능 범위는 "충전 - 사용 - 보너스"에서 파생된다
```

**핵심 분리 3가지 (이미 구현됨)**
- `payments.amount` = 낸 돈 / `intents.total_amount` = 준 크레딧 / `wallet transaction` = 움직인 잔액
- 지급은 `message_charge_intent_grant()` 한 트랜잭션 (멱등키 = intent_id)
- 가격 미설정이면 발송하지 않음 (`PRICE_NOT_CONFIGURED`)

---

## ② 정책 결정표 (CEO/CPO 결정 필요)

| # | 항목 | CTO 추천 | 이유 |
|---|---|---|---|
| 1 | **충전 상품 방식** | **C 혼합형**(직접 충전 + 프로모션 + 운영 지급), 베타 UI는 **직접 충전만 노출** | 데이터는 이미 4종(`payment/admin_grant/promotion/compensation`)을 표현한다. UI만 좁히면 되고, 나중에 상품을 추가해도 스키마가 안 바뀐다 |
| 2 | **보너스 정책** | 베타에는 **보너스 0**으로 시작 | 보너스를 주는 순간 ③ 차감 순서·환불 계산이 동시에 필요해진다. 알리고 원가가 확정되기 전엔 마진을 알 수 없다 |
| 3 | **차감 순서** | **D(총액만 관리)** 로 시작 — 단, 보너스를 도입하면 **A(보너스 우선)** 권고 | 현재 지갑은 단일 잔액 풀이라 D만 표현 가능(§③ GAP). 보너스 우선이 환불 분쟁이 가장 적다(환불 대상은 "낸 돈"만 남으므로) |
| 4 | **VAT 기준** | 충전액을 **VAT 포함 결제금액**으로 표시하고, 공급가/세액을 `payments`에 **분리 저장** | 표시가 헷갈리면 영수증 분쟁이 난다. 다만 **크레딧 판매의 과세 시점**은 세무 확인 필요(§⑦) |
| 5 | **환불 기준** | 미사용분만 환불, **보너스는 환불 대상 아님**, 사용분은 환불 불가 | 보너스는 무상 지급이라 현금 환급 대상이 아니다. 부분 환불은 "충전 - 사용" 계산이 필요하다 |
| 6 | **잔액 유효기간** | **MVP 무제한**(소멸 기능 만들지 않음) | CPO 방향과 동일. 단 §③에 "나중에 넣으려면 무엇이 필요한지" 기록 |
| 7 | **가격 변경 방식** | 정책은 버전으로 관리하고 **과거 거래는 재계산하지 않는다** | 이미 `message_log.tenant_charge`에 건별 금액이 박제된다(§⑥ 검증 2 통과) |

---

## ③ 현재 스키마 GAP 분석 (실측)

| 대상 | 있음 | **없음** |
|---|---|---|
| `message_wallet` | `available_balance` · `reserved_balance` · `amount_unit` | `bonus_balance` · `expires_at` |
| `message_wallet_transactions` | `type` · `reference_type/id` · `reason` · `metadata` | `expires_at` · `bucket` |
| `payments` | `amount` · `confirmed_amount` | `payment_fee` · `vat_amount` · `supply_amount` · `receipt_url` |
| `message_log` | `provider_cost` · `platform_fee` · `tenant_charge` | `price_version` |
| `message_charge_intents` | `wallet_amount` · `bonus_amount` · `total_amount` · `policy_snapshot` | `expires_at` |

### 지금 구조로 **가능한 것**
- 충전/보너스 **지급 시점 구분**(intent가 두 금액을 따로 보존)
- 건별 비용 스냅샷(원가/수수료/청구액 3분리)
- 지급·차감의 완전한 추적(원장 + reference)
- 운영 보정(`adjust` + 사유)

### 지금 구조로 **불가능한 것 → STOP 3**
> **충전금과 보너스의 "차감 순서"를 표현할 수 없다.**
> 지갑은 단일 풀(`available_balance`)이고, 지급도 `charge` 1건(`total_amount`)으로 들어간다.
> 사용(`capture`)은 어느 쪽에서 빠졌는지 알 수 없다. 즉 **D(총액 관리)만 가능**하다.

같은 이유로 **잔액 유효기간도 불가능**하다 — 어떤 크레딧이 먼저 만료되는지 계산할 lot이 없다.

**나중에 필요해지면 두 가지 중 하나** (지금 만들지 않음)
1. `wallet`에 `bonus_balance` 추가 + charge를 2건(paid/bonus)으로 분리 → 단순하지만 만료는 여전히 불가
2. **lot 방식** — `message_wallet_credits(intent_id, kind, amount, remaining, expires_at)` 신설 후 FIFO 차감 → 차감 순서·만료 둘 다 해결, 대신 원장이 2계층이 된다

### VAT/수수료 관련 GAP
`payments`에 `supply_amount` / `vat_amount` / `payment_fee`가 없다. **정책이 정해지면 migration 필요** (§⑦, STOP 1 후보).

---

## ④ SaaS 사용자 흐름 — 상태와 문구 (UI 구현 없음)

| 상태 | 조건 | 사장님에게 보여줄 것 |
|---|---|---|
| 서비스 미신청 | `serviceStatus = disabled` | 메뉴 미노출. Admin이 열어주면 안내 화면 |
| 서비스 신청 대기 | `pending` | "메시지 서비스를 준비하고 있습니다" + 시작 버튼 |
| 서비스 활성 | `enabled`, 이벤트 OFF | "보낼 알림을 선택해주세요" |
| **가격 미설정** | 단가 정책 없음 | "메시지 단가가 준비 중입니다. 지금은 발송되지 않습니다" — **현재 상태** |
| 잔액 준비 중 | 지갑 없음 | 잔액 "준비 중", 충전 비활성 |
| 결제 처리 중 | payment `pending` | "결제를 확인하고 있습니다" (자동 갱신) |
| 충전 완료 | intent `granted` | "충전이 완료되었습니다. 현재 잔액 N원" |
| **잔액 부족** | reserve 실패 | "잔액이 부족해 발송되지 않았습니다" + 충전 유도. **주문·배송은 정상 처리됨을 함께 안내** |
| 환불/조정 발생 | `adjust`/환불 거래 | "운영자 조정: 사유 + 금액" 내역에 표시 |
| 서비스 정지 | `suspended` | "메시지 서비스가 중지되었습니다" |

**중요**: 잔액 부족·가격 미설정 문구는 반드시 *"주문/배송은 정상 처리되었습니다"* 를 함께 말한다.
메시지 실패가 업무 실패로 읽히면 사장님이 배송을 다시 확인하러 간다.

---

## ⑤ Admin 운영 흐름

| 단계 | Admin이 하는 것 | **시스템이 해야 하는 것** |
|---|---|---|
| 서비스 개방 | 테넌트별 `pending`으로 열기 | — |
| 가격 정책 | 단가 등록·버전 관리 | 발송 시 그 시점 단가 적용·스냅샷 |
| 충전 | (베타) 운영 지급 `admin_grant` + 사유 | 결제 확정 시 **자동** grant |
| CS 보정 | `adjust` + 사유 필수 | — |
| 실패 확인 | "confirmed인데 granted 아님" 목록 조회 | 재시도(멱등) |
| 잔액 부족 | 조회만 | 발송 중단 + 로그 기록 |

> **금지 규칙**: `Payment confirmed → Wallet charge`를 **운영자가 버튼으로 매번 처리하지 않는다.**
> 자동 연결(F4)이 되기 전까지는 결제를 열지 않는다.

---

## ⑥ 핵심 검증 3가지 (CPO 지정)

| | 질문 | 결과 |
|---|---|---|
| 1 | 충전금과 보너스를 **미래에 구분**할 수 있는가? | **지급 시점은 가능**(intent가 분리 보존). **사용/차감 시점은 불가** — 단일 잔액 풀이라 lot이 없다 → §③의 두 방안 중 선택 필요 |
| 2 | 가격이 변해도 **과거 금액이 변하지 않는가**? | **가능.** `message_log.tenant_charge`에 건별 확정액이 박제되고, 원장은 append-only이며, intent는 `policy_snapshot`을 보존한다. 단 `price_version`이 없어 "어떤 정책이 적용됐는지" 추적은 스냅샷 JSON에 의존한다 |
| 3 | 환불/차감/보정이 **append-only를 깨지 않는가**? | **가능.** 모든 보정은 새 거래를 추가하는 방식이고 과거 행은 트리거가 막는다. 다만 현재 타입은 `adjust` 하나뿐이라 **의미 구분이 `reason` 문자열에만 있다** → 아래 권고 |

### 환불 표현 권고 (구현하지 않음)
- **타입은 늘리지 않는다.** `refund`/`clawback`을 타입으로 추가하면 기존 check 제약 변경(=기존 테이블 migration)이 필요하고, RPC 분기도 늘어난다.
- 대신 **`reference_type` + `reason`으로 의미를 구분**한다(이미 자유 문자열):
  `reference_type='refund'`, `reason='refund_full' | 'refund_partial' | 'chargeback' | 'customer_service' | 'system_correction'`
- 즉 **원장 타입(무엇을 했나) ≠ 사업 사유(왜 했나)** 를 섞지 않는다. CPO가 §10에서 지적한 그대로다.
- 환불 5케이스 판정(정책 확정 후 구현): 전액(미사용) → `adjust -total` / 부분 → `adjust -(환불액)` / 보너스 포함 → **보너스는 회수만 하고 현금 환급 없음** / 운영 지급 → 환급 대상 아님 / chargeback → 강제 회수 + 서비스 정지 검토

---

## ⑦ VAT — 데이터 구조 질문과 세무 확인 질문 분리

**제품 데이터 구조상 필요한 구분** (우리가 정할 수 있는 것)
- `payments`에 `supply_amount`(공급가) / `vat_amount`(세액) / `payment_fee`(PG 수수료) 분리 저장
- 표시 금액이 VAT 포함인지 명시
- 영수증/세금계산서 식별자 보관 위치

**세무 전문가 확인이 필요한 질문** (CTO가 판단하지 않음)
1. 선불 크레딧 판매의 **과세 시점** — 충전 시점인가, 메시지 사용 시점인가
2. 보너스 크레딧(무상 지급)의 과세 여부
3. 미사용 크레딧 환불 시 부가세 처리
4. 우리가 알리고 원가를 대납하고 재판매할 때의 **매입세액 공제** 구조
5. 세금계산서 발행 주체·시점

→ **이 답에 따라 `payments` 컬럼 구성이 달라진다(STOP 1).**

---

## ⑧ STOP 판정

| | 상태 |
|---|---|
| **STOP 1** VAT에 따라 모델 변경 | **발생** — `supply_amount/vat_amount/payment_fee` 부재. 세무 답변 후 migration 필요 |
| **STOP 2** 환불로 인한 타입 변경 | **미발생**(권고안 채택 시) — `reference_type`+`reason`으로 표현 가능해 기존 타입 유지 |
| **STOP 3** 차감 순서 표현 불가 | **발생** — 단일 잔액 풀이라 보너스/충전금 구분 차감 불가. 보너스를 도입하려면 구조 선택 필요 |
| STOP 4 알리고 원가 구조 부족 | **미발생**(현재 근거로는) — 원가/수수료/청구액 3분리로 충분. 단 알리고 회신 후 재확인 |
| **STOP 5** 상품 구조 미확정 | **발생** — 충전 상품 방식이 정해져야 Payment/Intent 생성 규칙(금액 검증·최소 결제액)을 정할 수 있다 |

---

## ⑨ F3D 이후 로드맵

| 단계 | 내용 | migration | 실제 결제/발송 |
|---|---|---|---|
| **F3D-1** 정책 확정 | ②표의 7개 + VAT 세무 답변 | 없음 | 없음 |
| **F3D-2** Pricing/Charge 스키마 | 단가 테이블(+버전) / VAT 컬럼 / (보너스 도입 시) lot 구조 | **필요** | 없음 |
| **F4** 자동 연결 | `Payment.confirmed → intent grant` 자동화 | 없음(예상) | 없음 |
| **F5** 실제 PG | Provider 구현체 + 결제창 + webhook endpoint | 없음(예상) | **실제 결제 발생** |
| **G** 알리고 연동 | Provider 구현체 + 템플릿 승인 | 없음(예상) | **실제 발송 발생** |

**순서 원칙**: 단가(F3D-2)가 없으면 발송이 막히고, 상품(F3D-1)이 없으면 결제 금액을 정할 수 없다.
**그래서 PG(F5)보다 정책(F3D)이 먼저다.**
