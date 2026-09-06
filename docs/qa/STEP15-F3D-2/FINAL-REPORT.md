# STEP15-F3D-2 FINAL REPORT — Pricing Policy Infrastructure

> 2026-09-07 / CTO. migration 0060 적용 완료(CEO), 전량 실측 종료.
> **실제 결제 0 / 실제 발송 0 / 운영 가격 seed 0 / 잔여물 0.**

## 1. Migration

| | |
|---|---|
| 파일 | `supabase/migrations/0060_message_pricing_policies.sql` (적용 완료) |
| 신규 테이블 | `message_pricing_policies` |
| 기존 변경 | **`message_log.price_policy_id` 하나뿐** (uuid nullable, FK ON DELETE RESTRICT) |
| 신규 인덱스 | `uq_pricing_active_scope`(부분 unique), `idx_pricing_lookup`, `idx_pricing_status`, `idx_message_log_price_policy` |
| 트리거 | `trg_message_pricing_policies_guard` (before update) |
| 함수 | `message_pricing_policies_guard()` 1개. **신규 RPC 없음** |
| 기존 데이터 | 변경 없음. 역채우기 없음 |

## 2. DB 실측 — DDL 읽기가 아니라 실제 INSERT / UPDATE / DELETE

| 항목 | 결과 |
|---|---|
| `message_log.price_policy_id` 존재 | PASS |
| `unit_price = 0` / 음수 | 차단 |
| 허용 외 `status` / `kind` / `message_type` | 차단 |
| **global(owner=null) active 2건째** | **차단** ← coalesce 인덱스가 의도대로 동작 |
| 같은 tenant active 2건째 | 차단 |
| tenant active + global active 공존 | 허용 |
| 다른 tenant active | 허용 |
| 같은 범위 draft / retired 다건 | 허용(이력 보존) |
| draft 단가·축 수정 | 허용 |
| active 단가 / message_type / provider / owner 수정 | **전부 차단** |
| active `note` 수정 | 허용(가격 축이 아니다) |
| `retired → active` 되살리기 | 차단 |
| 은퇴한 v1 단가 수정 | 차단 |
| 참조된 정책 DELETE | **RESTRICT로 차단** |
| 참조 없는 draft / retired DELETE | 허용 |
| **참조 로그 정리 후 정책 삭제** | **가능** — 보호 로직이 정상 정리를 막지 않는다 |
| 정책 참조 로그가 있어도 주문 삭제 | 정상 동작 |

> 0055·0058에서 두 번 났던 "보호 트리거가 FK 정리까지 막는" 사고가 **재발하지 않음을 실측**했다.
> 이번엔 `pg_trigger_depth()`를 복사하지 않고, 이 테이블로 들어오는 cascade/set-null FK가
> 0개임을 근거로 **잠글 컬럼을 좁게 지정**하는 방식을 골랐고, 그 판단이 맞았다.

## 3. Resolver

| | |
|---|---|
| tenant 우선 | PASS (tenant·global 동시 존재 시 tenant 선택) |
| global fallback | PASS |
| 정책 없음 | PASS (null 반환) |
| draft·retired 선택 금지 | PASS |
| 다른 테넌트 정책 미적용 | PASS |
| provider / message_type / **kind**가 다르면 미적용 | PASS (kind가 독립 축임을 실측) |
| fail closed | `maybeSingle()` — active 2건이면 에러가 나고 첫 행을 고르지 않음. 임의 기본가·0원 없음 |

## 4. Dispatch 연결

```
resolve → {policyId, unitPrice} → reserve → provider → capture/release
        → message_log( tenant_charge = 얼마 , price_policy_id = 왜 )
```
- v1 발송: `status=sent`, `tenant_charge = v1`, `price_policy_id = v1` **동시 기록** PASS
- capture로 잔액 차감·예약 0 복귀 PASS
- 추가 계산 경로 없음(단가 결정 지점은 여전히 한 곳)

## 5. 가격 없음 안전성 (이번 단계의 핵심 안전장치)

| | |
|---|---|
| `PRICE_NOT_CONFIGURED` 기록 | PASS |
| reserve | **0** |
| Provider 호출 | **0** |
| 잔액·예약 변동 | **0** |
| 원장(`reference_type='message'`) | **0건** |
| 실제 발송 | **0** |

운영 가격을 넣지 않았으므로 **이것이 현재 제품의 정상 상태**다.

## 6. v1 → v2 불변성

```
v1 active → 발송 → retired      v2 draft → active → 발송
```
- v2 로그: 금액 = v2, 정책 = v2 — PASS
- **v1 로그: 금액·정책 id 변화 없음** — PASS
- 은퇴한 v1 행의 단가가 그대로 남아 조회 가능 — PASS
- v1 단가 수정 차단 / v1 삭제 RESTRICT — PASS

→ **과거 로그가 새로운 가격 정책으로 재해석될 수 없다.**

## 7. 권한 / 보안

| | |
|---|---|
| anon SELECT (`message_pricing_policies`) | 차단 |
| anon INSERT | 차단 |
| anon UPDATE | **값 실제 불변** 확인 |
| anon DELETE | **행 실제 잔존** 확인 |
| anon RPC (wallet / grant) | 차단 (신규 RPC 없음) |
| 사장님(user) | 정책 생성·활성·은퇴 액션 전부 `role !== "admin"` 차단. 화면에도 없음 |

> **오탐 교정 1건**: anon UPDATE/DELETE를 "에러가 났는가"로 판정했는데, RLS는 행을 안 보이게
> 하는 방식이라 대상이 0건이면 **성공으로 응답한다**. 응답이 아니라 **값이 실제로 바뀌었는지**를
> 봐야 한다. 표적 행을 만들어 공격 후 admin으로 대조하도록 바꿨다(assertion 완화가 아니라 강화).

## 8. 회귀 (실제 실행 결과)

| 스크립트 | 결과 |
|---|---|
| step15f3d2-pricing-policy (신규) | **51/51** |
| step15f3c-charge-intent | 31/31 |
| step15f3-payment-foundation | 41/41 |
| step15f2-message-wallet | 24/24 |
| step15f2-wallet-access-control | **18/18** (16 → 항목 2개 추가) |
| step15f1-message-saas | 24/24 |
| step15c-message-dispatch-flow | 29/29 |
| step15b-message-foundation | 17/17 |
| delivery-flow | 29/29 |
| e2e-p2-scenario-c-crud (주문 CRUD) | 16/16 |
| data-integrity-audit | **RED 0 / YELLOW 0 / 52 검사** |

## 9. Cleanup

```
message_pricing_policies 0 · message_log 0 · message_wallet 0 · wallet_transactions 0
payments 0 · payment_events 0 · message_charge_intents 0
운영 가격 정책 0 (seed 없음)
git status clean
```

## 10. 이번에 발견한 결함

**2건. 둘 다 QA 쪽이고, 제품 결함은 없었다.**

**① anon UPDATE/DELETE 판정 오탐** — 원인: RLS의 차단 방식(행 비가시)을 에러 응답으로 오해.
영향: 실제로는 안전한데 FAIL로 나옴(반대 방향이었다면 뚫린 걸 PASS로 볼 뻔했다).
수정: 표적 행 대조 방식. 재발 방지: 앞으로 쓰기 차단 검증은 **응답이 아니라 상태**로 본다.

**② QA cleanup 잔여 1건** — 원인: `note`를 정확히 비교했는데 "운영 메모 수정 허용" 케이스에서
그 값이 바뀜. 영향: 첫 실행 후 정책 1건이 실제로 남음(즉시 제거, 현재 0).
수정: 접두어 매칭. 재발 방지: cleanup 키는 **테스트 중 변경되는 컬럼을 쓰지 않는다.**

## 배포

`tsc PASS / ESLint PASS / Build PASS`, Vercel 배포 성공, `https://jumunhanjang.vercel.app` **200**.
운영자 화면 실측: **"메시지 단가 정책" 패널 노출 / "설정된 가격 정책 없음" 표시 /
하드코딩된 "단가 정책 미설정" 문구 제거 확인**.
