# STEP15-F3D-1 — 충전·단가·세무·사장님 UX 정책 정의 (조사·설계)

> 2026-09-06 / CTO. **코드·DB 변경 0.** 금액 숫자는 어디에도 넣지 않았다.
> 목표는 기능 구현이 아니라, 이미 닫아둔 경계(Payment / Charge Intent / Wallet / Ledger) 위에
> **실제 SaaS 과금 경험을 올릴 수 있는 정책과 데이터 모델을 확정**하는 것.

---

## A. Pricing Policy 구조

### A-1. 별도 테이블이 필요한가 → **필요하다**

지금은 단가가 코드(`UnconfiguredPricingPolicy`)에만 있고 항상 `null`이다. 가격을 코드에 넣으면
① 배포 없이 못 바꾸고 ② **언제부터 얼마였는지 기록이 남지 않는다.** 과금 분쟁은 대부분
"그때 얼마였냐"에서 생긴다.

### A-2. 개념 모델 (테이블 생성은 F3D-2에서)

```
message_pricing_policies
  id · version(정수, 단조 증가)
  scope           platform | tenant      ← 베타는 platform 하나로 시작, 구조는 override 허용
  owner_username  scope='tenant'일 때만
  event_type      ORDER_RECEIVED | DRIVER_ASSIGNED | DELIVERY_COMPLETED | null(전체)
  message_type    alimtalk | sms | lms
  provider        aligo | …             ← 원가는 공급사에 종속된다
  tenant_charge   고객 청구 단가(1/100원 정수)
  provider_cost   공급사 원가(참고·정산 대조용)
  effective_from · effective_to(null=현재)
  status          draft | active | retired
  created_by · created_at
```

**핵심 규칙 — 가격은 수정하지 않고 새 버전을 만든다.**
```
v1  2026-10-01 ~ 2026-11-30   (retired)
v2  2026-12-01 ~ null         (active)
```
`update`로 단가를 고치는 경로를 아예 만들지 않는다(권고: `active` 행의 `tenant_charge` 변경을
트리거로 차단 — **단, 0055/0058의 실수를 반복하지 않도록 FK 정리·상태 전이는 통과시키는 조건부**).

### A-3. 가격 변경이 기존 Charge Intent에 미치는 영향 → **없다**

Charge Intent는 **충전** 정책이고 Pricing Policy는 **사용** 단가다. 둘은 다른 축이라
단가를 바꿔도 이미 지급된 크레딧 금액은 변하지 않는다. (F3D에서 "두 정책을 하나의 `price`로
합치지 않는다"고 정한 이유가 여기서 값을 한다.)

### A-4. `message_log`와의 연결 — **GAP 1건 발견**

실측 결과 `message_log`에는 `metadata` / `price_version` / `policy_id`가 **없다**.

| 지금 남는 것 | 지금 남지 않는 것 |
|---|---|
| `tenant_charge`(실제 차감액) · `provider_cost` · `platform_fee` | **어떤 가격 정책 버전이 적용됐는지** |

즉 **"얼마 받았나"는 박제되지만 "왜 그 금액이었나"는 추적할 수 없다.** 금액 자체는 안전하므로
과거 재계산 위험은 없지만, 정산·CS에서 "이 건은 v1 단가였다"를 증명할 수 없다.

**권고**: F3D-2에서 `message_log.price_policy_id`(nullable uuid) 한 컬럼 추가.
- 기존 테이블 변경이지만 **nullable 추가라 기존 행은 그대로 null**이고 데이터 손실이 없다.
- 대안(스냅샷 JSON을 통째로 저장)은 로그가 커지고 조회가 어렵다.

### A-5. 스냅샷 필요 여부

- **Charge Intent**: `policy_snapshot` **이미 있음** — 충전 시점의 상품·보너스 조건을 그대로 보존.
- **message_log**: 금액 3종이 이미 박제되므로 **전체 스냅샷은 불필요**, 위 `price_policy_id`만으로 충분.

> **보장 결론**: 과거 발송 금액은 재계산되지 않는다. 근거는 ① 원장 append-only ② `tenant_charge`
> 건별 확정 저장 ③ 단가는 수정이 아니라 새 버전. `price_policy_id`는 "증명"을 위한 보강이다.

---

## B. Charge Intent 정책 모델 재검토

### B-1. 현재 `kind` 표현 범위 — **실측**

```
허용: payment · admin_grant · promotion · compensation
거부: future_refund   ← check 제약이 실제로 막는 것을 확인
```

### B-2. 환불/회수를 어떻게 표현할 것인가 (구현 없음)

| 방식 | 평가 |
|---|---|
| `kind`에 `refund`/`clawback` 추가 | **기존 테이블 check 제약 변경** = migration. 게다가 Intent는 "지급 의도"인데 회수를 같은 표에 넣으면 의미가 섞인다 |
| **원장에서 표현**(권고) | `message_wallet_transactions`에 `adjust` + `reference_type='refund'` + `reason`. **타입 추가 없음, 기존 스키마 변경 0** |

**권고: 회수는 Intent가 아니라 원장 사건으로 본다.**
- 지급(Intent) = 미래에 줄 것을 약속 → grant로 실현
- 회수(환불) = 이미 준 것을 되돌림 → **새 원장 거래**
- 연결이 필요하면 `reference_id`에 원래 intent id를 넣어 추적한다(자유 문자열이라 가능).

단, **환불 금액 산정 규칙**(미사용분 한정, 보너스 제외)은 정책이므로 F3D-1 결정표에 남긴다.

### B-3. `promotion` / `compensation`

이미 `kind`에 있으나 **UI·기능 없음**이 맞다. 베타는 `payment`와 `admin_grant`만 쓴다.
`bonus_amount`도 구조는 있고 **값은 0**으로 시작(F3D 결정).

---

## C. VAT / 세무 데이터 구조 — 사후 추가 안전성

### C-1. 실측
`payments`에 `supply_amount` / `vat_amount` / `payment_fee` / `metadata` **없음**. 현재 행 수 0.

### C-2. 나중에 추가해도 기존 데이터를 잃는가 → **잃지 않는다. 단 조건이 있다.**

- **nullable 컬럼 추가는 안전하다.** 기존 행은 null이 되고 값은 그대로다.
- **위험한 것은 컬럼 추가가 아니라 `amount`의 의미 재해석이다.**
  나중에 "amount는 공급가였다"로 해석을 바꾸면 **과거 결제가 전부 오염된다.**

**그래서 지금 못 박는다** — `payments.amount` = **고객이 실제로 결제한 총액(VAT 포함)**.
(F3A에서 "PG에 요청한/승인되어야 할 금액"으로 정의한 것과 모순 없음.)
`supply_amount` / `vat_amount`는 나중에 **파생 저장**하고, 둘의 합이 `amount`와 맞는지
DB check로 강제하면 과거 행(null)은 검사 대상에서 빠진다.

### C-3. 세무 확인 질문 (CTO 판단 아님, F3D 보고서에서 이어짐)
선불 크레딧의 과세 시점 / 보너스 크레딧 과세 여부 / 미사용 환불 부가세 / 재판매 매입세액 공제 /
세금계산서 발행 주체·시점.

**STOP 1 유지** — 답에 따라 F3D-2 스키마가 달라진다. 다만 **지금 결제를 열지 않으므로 진행을 막지는 않는다.**

---

## D. 사장님 UX — 11개 상태 정의

원칙 하나를 모든 실패 문구에 고정한다.

> **메시지가 발송되지 않아도 주문과 배송은 정상 처리되었습니다.**
> (이 문장이 없으면 사장님이 배송을 다시 확인하러 나간다 — 우리가 없애려는 바로 그 행동이다.)

| # | 상태 | 조건 | 화면 문구 | CTA | 가능 | 불가능 | 배송·주문 영향 |
|---|---|---|---|---|---|---|---|
| 1 | 서비스 미사용 | `serviceStatus=disabled` | (메뉴 미노출) | — | — | 전부 | 없음 |
| 2 | 서비스 신청 가능 | Admin이 `pending`으로 열어줌 | "배송 상태가 바뀌면 고객에게 알림을 보낼 수 있습니다" | **메시지 서비스 시작하기** | 안내 확인·동의 | 알림 설정 | 없음 |
| 3 | 활성화 대기 | 동의 전 | "안내 내용을 확인해주세요" | (체크 필요) | — | 시작 | 없음 |
| 4 | 서비스 활성화 | `enabled`, 이벤트 OFF | "보낼 알림을 선택해주세요" | 이벤트 토글 | 알림 선택 | 발송 | 없음 |
| 5 | 잔액 없음 | 지갑 미생성 | 잔액 **"준비 중"** | — | 설정 | 충전·발송 | 없음 |
| 6 | 충전 준비 중 | PG 미연동 | "충전 기능을 준비하고 있습니다" | (비활성) | — | 충전 | 없음 |
| 7 | 정상 사용 | 단가 O·잔액 O·이벤트 ON | "현재 잔액 N원" + 발송 내역 | 충전하기 | 전부 | — | 없음 |
| 8 | **잔액 부족** | reserve 실패 | "잔액이 부족해 알림이 발송되지 않았습니다. **주문과 배송은 정상 처리되었습니다.**" | 충전하기 | 충전 | 발송 | **없음** |
| 9 | **가격 미설정** | `PRICE_NOT_CONFIGURED` | "메시지 단가가 준비 중이라 아직 발송되지 않습니다. **주문과 배송은 정상 처리됩니다.**" | — | 설정 | 발송 | **없음** — 현재 상태 |
| 10 | Provider 미설정 | 공급사 미연동 | "메시지 발송 준비 중입니다" | — | 설정 | 발송 | 없음 |
| 11 | 서비스 정지 | `suspended` | "메시지 서비스가 중지되었습니다. 문의해주세요" | 문의하기 | 내역 조회 | 설정·발송 | 없음 |

**추가 상태(운영 중 발생)**
- 결제 처리 중(payment `pending`) — "결제를 확인하고 있습니다"
- 충전 완료(intent `granted`) — "충전이 완료되었습니다"
- **결제됐지만 지급 실패**(confirmed / not granted) — 사장님에게는 "충전을 처리하고 있습니다"로만
  보이고, **Admin 목록에는 반드시 노출**한다(자동으로 숨기지 않는다는 F3C 원칙).

---

## E. 결정 필요 항목 (CEO/CPO)

| # | 항목 | CTO 추천 | 비고 |
|---|---|---|---|
| 1 | 충전 방식 | **직접 금액 충전**(프리셋 버튼은 UI 표시용, 코드/DB 하드코딩 없음) | CPO 방향과 동일 |
| 2 | 보너스 | **베타 0**(구조는 지원, 미활성) | 차감 순서 문제를 뒤로 미룸 |
| 3 | 유효기간 | **무제한** | lot 구조 불필요 |
| 4 | 단가 관리 | **버전 테이블 + 수정 금지, 새 버전 생성** | A-2 |
| 5 | `price_policy_id` 추가 | **추가 권고**(nullable) | A-4, 유일한 기존 테이블 변경 |
| 6 | 환불 표현 | **원장 사건**(`adjust`+`reference_type='refund'`) | B-2, 스키마 변경 0 |
| 7 | `payments.amount` 의미 | **VAT 포함 결제 총액으로 고정** | C-2, 지금 못 박아야 안전 |
| 8 | VAT 컬럼 | 세무 답변 후 nullable 추가 | STOP 1 |

---

## F. STOP 판정

| | 상태 |
|---|---|
| **STOP 1** VAT 모델 | **유지** — 세무 답변 필요. 단 결제를 열지 않아 진행은 막히지 않음 |
| STOP 2 환불로 인한 타입 변경 | **미발생**(B-2 권고 채택 시) |
| **STOP 3** 차감 순서 | **유지** — 보너스 0으로 시작하면 **당분간 발생하지 않음** |
| STOP 4 알리고 원가 구조 | 미발생 — 회신 후 재확인 |
| **STOP 5** 상품 구조 | **해소 방향** — "직접 금액 충전"으로 정하면 결제 금액 검증 규칙(최소/최대·정수 단위)만 정하면 됨 |

---

## G. F3D-2 예상 범위 (승인 시)

```
신규   message_pricing_policies (+ active 단가 수정 차단 트리거)
변경   message_log.price_policy_id  nullable 추가   ← 유일한 기존 테이블 변경
보류   payments.supply_amount / vat_amount / payment_fee  (세무 답변 후)
없음   Wallet·Charge Intent 스키마 변경
```

실제 결제·발송은 F3D-2에서도 **0**이다.
