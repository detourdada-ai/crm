# STEP15-F3 — Payment Foundation (조사 · 설계 · 구현 가능 여부)

> 2026-09-06 / CTO. **실제 PG 연동·결제창·충전 상품·가격 0.** 기본 Provider는 `NoopPaymentProvider`.
> Payment 테이블은 migration이 필요해 **적용하지 않았고**, §4에서 STOP 보고한다.

## 1. 가장 중요한 원칙 — 두 원장을 섞지 않는다

```
Payment           고객이 실제로 돈을 낸 **외부 거래 사실**
Wallet Ledger     우리 서비스 내부 **잔액 거래**
Admin Adjust      운영자 보정
```

**결제 성공이 잔액을 바꾸지 않는다.** 확인된 결제를 근거로 *별도의* wallet charge가
일어나야 하고, F3에서는 그 연결을 하지 않았다. QA에서 결제 시나리오를 전부 돌린 뒤
**Wallet 잔액·원장이 1건도 변하지 않는 것**을 확인했다(그게 현재의 정상이다).

## 2. PaymentStatus — PG 상태를 복제하지 않는다

토스페이먼츠 기준으로 확인한 실제 상황:

| 관찰 | 근거 |
|---|---|
| 승인 대기 상태가 존재한다 | `IN_PROGRESS`(인증 완료 후 승인 API 호출 대기) |
| 입금 대기가 따로 있다 | 가상계좌 `WAITING_FOR_DEPOSIT` |
| **Webhook은 중복 도착한다** | 2xx가 아니면 **최대 7회 재시도** → 멱등 처리 필수 |
| 상태가 뒤집힐 수 있다 | 입금 오류 시 `DONE → WAITING_FOR_DEPOSIT`(1.5+) 또는 `DONE → CANCELED`(1.4-) |

여기에 CPO가 지적한 사용자 이탈(결제창 닫기), 서버 다운, 성공 응답과 Webhook 순서 역전을
더해, **우리가 실제로 구분해야 하는 최소 상태**만 남겼다.

```
created    우리 쪽에서 결제를 만들었고 아직 결제창으로 가지 않음
pending    진행 중 / 승인·입금 대기      ← IN_PROGRESS·WAITING_FOR_DEPOSIT를 흡수
confirmed  금액까지 검증된 최종 성공     ← 이 상태에서만 충전 근거가 된다
failed     승인 거절 등 실패
cancelled  사용자·우리가 취소
expired    유효시간 초과
```

PG 원본 값은 버리지 않고 `PaymentResult.rawStatus`에 보존한다 — 감사·디버깅에는 필요하지만
**제품 로직이 PG 문자열에 종속되면 PG를 바꿀 때 도메인이 흔들린다.**

## 3. 설계 (구현 완료 · 코드)

```
PaymentProvider          createPayment / getPayment / verifyWebhook
  └ NoopPaymentProvider  기본값. 결제를 만들지 않고 어떤 webhook도 인정하지 않는다
PaymentIntent            paymentId · owner · amount(1/100원 정수) · status · idempotencyKey
                         · provider · providerPaymentId · createdAt · confirmedAt · failureReason
PaymentResult            provider · providerPaymentId · status · rawStatus · confirmedAmount · confirmedAt
PaymentWebhookEvent      provider · providerPaymentId · eventId · status · rawStatus · amount · occurredAt
PaymentStore             저장 요구사항을 인터페이스로 고정(현재 인메모리 구현으로 경계 검증)
```

### Webhook 처리 경계
```
payload → verifyWebhook(서명 검증)   ← 검증 실패는 이벤트로 취급하지 않는다
        → eventId 중복 차단
        → **서버 대 서버 조회로 재확인**  ← webhook 값만 믿지 않는다
        → 요청 금액과 대조(불일치면 failed)
        → 상태 반영
        → (F3에서는 여기서 끝. wallet charge 없음)
```
공개 endpoint는 만들지 않았다 — 외부에서 실제 결제 이벤트가 들어올 수 있는 운영 기능이
되면 안 되고, 테스트는 mock payload로만 한다.

**금액은 Wallet과 동일한 1/100원 정수 단위**를 쓴다. 두 원장 사이에 단위 변환이 끼면
반올림 분쟁이 생긴다.

## 4. STOP 1 — Payment 저장소는 migration이 필요하다

### 안 A — 신규 테이블 (권장)
```
payment          결제 1건. owner_username · amount · status · idempotency_key
                 · provider · provider_payment_id · confirmed_at · failure_reason
payment_events   webhook/상태 변화 이력(append-only). provider · event_id · raw_status · payload_hash
```
- **필수 제약**: `unique(owner_username, idempotency_key)` — 같은 충전 요청 이중 생성 차단
  `unique(provider, provider_payment_id)` — 같은 PG 결제가 두 건으로 갈라지지 않게
  `unique(provider, event_id)` — **webhook 최대 7회 재시도**를 DB에서 흡수
- 인메모리 구현으로는 동시 요청 경쟁을 닫을 수 없다(QA에도 그렇게 기록했다). 실제 멱등성은
  이 unique 제약이 있어야 성립한다 — Wallet에서 쓴 방식과 동일하다.

### 안 B — 기존 구조 재사용 → **불가**
`message_wallet_transactions`를 결제 기록으로 겸용하는 것은 금지다. Payment는 **외부 거래**,
Wallet은 **내부 잔액**이고, 환불·부분취소·PG 대사(reconciliation)가 붙는 순간 두 원장의
수명주기가 달라진다. 기존 테이블 중 결제 이력에 맞는 것은 없다.

**→ 신규 테이블 2개가 필요하다. migration 영향·rollback·RLS 설계는 승인 시 제출하고,
지금은 적용하지 않는다.**

## 5. STOP 2 — PG 선택은 필요하지 않았다

설계를 진행하는 데 특정 SDK가 필요하지 않았다. 상태·webhook·멱등성 요구사항은 PG 공통이라
**Provider 인터페이스 뒤로 전부 숨겼다.** PG가 정해지면 구현체 하나만 추가하면 되고
도메인·QA는 그대로다.

## 6. STOP 3 / 4 — 미발생

실제 결제가 발생할 경로가 없다(Noop은 결제를 만들지 않고, 공개 webhook endpoint도 없다).
Wallet 자동 충전은 연결하지 않았다.

## 7. 화면

`/messages`의 `잔액 · 충전 → 준비 중`은 **그대로 유지**한다. 결제 버튼·충전 금액 선택·
카드 등록·결제창 전부 없다. Admin의 수동 `adjust`도 Payment와 섞지 않았다.

## 8. 남은 결정 (CPO/CEO)

1. **Payment 테이블 migration 승인** (§4 안 A)
2. PG 선택 — 승인 후 구현체 추가
3. 충전 상품 금액 · 메시지 단가 — 알리고 회신(재판매·원가·VAT·결제 수수료·환불) 이후
4. 환불/부분취소 정책 — Payment 상태와 Wallet 원장 양쪽에 영향
