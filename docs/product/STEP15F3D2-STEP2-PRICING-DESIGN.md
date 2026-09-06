# STEP15-F3D-2 STEP 2 — Pricing Policy 설계 보고서

> 2026-09-06 / CTO. **코드·DB 변경 0 / migration 미적용 / 운영 가격 입력 0 / 실제 결제·발송 0.**
> 승인 후에만 구현한다. 아래 DDL은 전부 **초안**이다.

---

## A. 최종 정책 모델 (DDL 초안)

```sql
create table if not exists message_pricing_policies (
  id uuid primary key default gen_random_uuid(),

  -- 정책 키 4축. owner_username이 null이면 플랫폼 공통 정책이다.
  owner_username text,                       -- null = global
  kind text not null
    check (kind in ('transactional', 'customer_notice', 'marketing')),
  message_type text not null
    check (message_type in ('alimtalk', 'sms', 'lms')),
  provider text not null,                    -- 'noop' | 'aligo' | …  (text, 제약 없음)

  -- 1/100원 정수. Wallet·Payment와 같은 단위(단위 변환을 끼우지 않는다).
  unit_price bigint not null check (unit_price > 0),
  amount_unit text not null default 'KRW_CENTI',
  -- 참고용 원가. 정산 대조에 쓰고 차감액과 섞지 않는다.
  provider_cost bigint check (provider_cost is null or provider_cost >= 0),

  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);
```

### 의도적으로 **넣지 않은** 것

| 항목 | 이유 |
|---|---|
| `effective_from` / `effective_to` | §D-2 안 A 채택. 지금 필요한 건 예약 기능이 아니라 **과거 증명**이다 |
| `tenant_id` FK | **§H-3의 FK 충돌 때문**. 아래에서 따로 설명 |
| 할인·쿠폰·프로모션 | 이번 범위 아님 |

---

## B. 정책 키 — 각 축의 의미와 현재 허용값

| 축 | 의미 | 현재 실제 값 | 형태 |
|---|---|---|---|
| `owner_username` | **누구의** 가격인가. null이면 플랫폼 공통 | 테넌트 slug 또는 null | text nullable |
| `kind` | **어떤 목적**의 메시지인가 | **`transactional`만 사용** | check 3종 |
| `message_type` | **어떤 형태**로 나가는가 | **`alimtalk`만 사용** | check 3종 |
| `provider` | **누가 보내는가**(원가가 여기 종속) | **`noop`만 사용**(향후 `aligo`) | text |

> **축은 미래를 표현하되 기능은 넓히지 않는다.** QA fixture도
> `transactional / alimtalk / noop` 조합만 쓴다. 마케팅·친구톡·SMS는 값만 허용하고
> **dispatch 경로를 만들지 않는다.**

### 코드 축과의 정합
현재 `MessageKind`는 `delivery_notice | customer_notice | marketing`이고 dispatch는
`delivery_notice`를 넘긴다. 정책의 `transactional`과 **이름이 다르다.**
→ 구현 시 **코드 쪽 이름을 정책 값에 맞추거나 매핑 함수를 한 곳에 둔다**(둘 다 STEP 3에서
한 줄 수준). 지금 DB에 `delivery_notice`를 넣으면 "정보성"이라는 의미가 배송에 묶여
나중에 주문 접수·공지에 재사용하기 어색해지므로 **`transactional`을 권고**한다.

---

## C. Active 중복 방지 SQL — **NULL 문제를 실제로 닫는다**

문제: PostgreSQL의 unique 인덱스는 **NULL을 서로 다른 값으로 취급**한다. 그래서 아래는
global 정책 중복을 막지 못한다.

```sql
-- ❌ 이렇게 하면 (null, transactional, alimtalk, noop, active) 행이 여러 개 생긴다
create unique index ... on message_pricing_policies (owner_username, kind, message_type, provider)
  where status = 'active';
```

**채택안 — `coalesce()` 표현식 인덱스**

```sql
create unique index uq_pricing_active_scope
  on message_pricing_policies (
    coalesce(owner_username, '__global__'),
    kind,
    message_type,
    provider
  )
  where status = 'active';
```

- global 정책은 전부 `'__global__'` 한 값으로 접히므로 **두 개가 될 수 없다.**
- 테넌트 정책은 slug 그대로라 테넌트별로 각각 하나씩만 가능하다.
- `draft`/`retired`는 인덱스 대상이 아니므로 **얼마든지 쌓일 수 있다**(이력 보존).
- PG15+의 `nulls not distinct` 대신 `coalesce`를 쓰는 이유: **버전 의존성이 없고, 의도가
  인덱스 정의만 봐도 읽힌다.**

> 앱 resolver만으로 막지 않는다. 이 인덱스가 **유일한 진실**이고, resolver는 그 위에서 고른다.

---

## D. 상태 모델

### D-1. 세 가지 상태

| 상태 | 의미 | dispatch에서 |
|---|---|---|
| `draft` | 작성 중 | **사용 불가** |
| `active` | 현재 발송에 적용 | 사용 |
| `retired` | 신규 발송에는 미사용. **과거 로그의 참조는 그대로 유지** | 사용 안 함 |

### D-2. `effective_from/to` — 안 A / 안 B 비교

| | **안 A (권고)** `status` 기반 | 안 B `effective` 기간 기반 |
|---|---|---|
| 가격 변경 | v1 `retired` → v2 `active` (운영자 명시적 행동) | 미래 시각 예약, 자동 전환 |
| 중복 방지 | **부분 unique 인덱스 하나로 끝** | 기간 중첩 → `exclude` + btree_gist 확장 필요 |
| 시간대·경계 | 없음 | 자정 경계·KST/UTC 문제 발생 |
| 과거 증명 | 동일하게 가능(로그가 정책 id를 들고 있으므로) | 동일 |
| 지금 필요한가 | — | 예약 변경 수요가 아직 없음 |

**권고: A.** 지금 필요한 것은 가격 엔진의 표현력이 아니라 **과거 가격의 증명**이다.
예약 기능은 운영이 시작된 뒤 `effective_from`을 **추가**해도 늦지 않다(nullable 추가 = 안전).

---

## E. 정책 수정 / 보호 규칙 (트리거 설계 **전에** 확정)

| 상태 | 단가 수정 | 축 변경(owner/kind/type/provider) | 상태 전환 | 삭제 |
|---|---|---|---|---|
| **draft** | **허용** | **허용** | `draft → active` 허용 | **허용**(아직 아무 데서도 안 씀) |
| **active** | **차단** | **차단** | `active → retired` 허용 | **차단**(사용 중인 가격은 지우지 않는다) |
| **retired** | **차단** | **차단** | 전환 없음(되살리려면 새 정책) | **참조 있으면 차단(FK RESTRICT), 없으면 허용** |

핵심: **가격 변경은 UPDATE가 아니라 새 정책 생성이다.** `draft`에서만 자유롭게 고치고,
`active`가 되는 순간 그 행은 사실상 불변이 된다.

### 트리거 설계 — `pg_trigger_depth()`를 **쓰지 않는다** (근거 포함)

0055·0058에서 두 번 사고가 났던 이유는 **다른 테이블의 FK 정리가 보호 대상 테이블을
UPDATE했기 때문**이다(`on delete set null`). 이번 테이블은 상황이 다르다.

- `message_pricing_policies`를 **참조하는** 쪽은 `message_log.price_policy_id` 하나이고,
  삭제 정책이 **RESTRICT**라 부모를 UPDATE하지 않는다.
- 이 테이블을 향해 `on update cascade` / `on delete set null` 로 들어오는 FK가 **하나도 없다**.
- `tenant_id` FK도 **일부러 두지 않는다**(§H-3) — 두면 테넌트 삭제 시 정책이 cascade 삭제되고,
  그 정책을 참조하는 로그의 RESTRICT와 충돌해 **테넌트 삭제가 실패**한다.

→ **FK가 이 테이블을 건드릴 경로가 없으므로 depth 예외가 필요 없다.** 대신 **잠글 컬럼을
좁게 지정**하는 방식으로 만든다. 그러면 상태 전환·`retired_at`·`updated_at`은 자연히 통과한다.

```sql
create or replace function message_pricing_policies_guard() returns trigger as $$
begin
  -- draft는 자유롭게 고친다(아직 어떤 발송에도 쓰이지 않았다).
  if old.status = 'draft' then
    return new;
  end if;

  -- active/retired에서는 "가격의 의미"를 이루는 값만 잠근다.
  -- status / retired_at / activated_at / updated_at은 여기 없으므로 통과한다.
  if new.unit_price     is distinct from old.unit_price
     or new.amount_unit is distinct from old.amount_unit
     or new.owner_username is distinct from old.owner_username
     or new.kind         is distinct from old.kind
     or new.message_type is distinct from old.message_type
     or new.provider     is distinct from old.provider then
    raise exception 'pricing policy is immutable once activated (%).', old.status;
  end if;

  -- 되살리기 금지: retired에서 다시 active로 올리지 않는다(새 정책을 만든다).
  if old.status = 'retired' and new.status = 'active' then
    raise exception 'retired pricing policy cannot be reactivated.';
  end if;

  return new;
end;
$$ language plpgsql;
```

> **기존 패턴 복사가 아니다.** 두 번의 사고 원인(FK 유발 UPDATE)이 이 테이블에는 존재하지
> 않는다는 것을 확인하고, 그래서 depth 조건 대신 **컬럼 화이트리스트 방식**을 골랐다.
> 다만 QA에는 FK/시스템 UPDATE 항목을 그대로 넣어 **가정이 틀렸는지 실측으로 확인**한다.

---

## F. Resolver — 선택은 앱, 정합성은 DB

```
resolvePricing({ ownerUsername, kind, messageType, provider })
   1. tenant active 정책 조회   (owner_username = ownerUsername)
        ↓ 없으면
   2. global active 정책 조회   (owner_username is null)
        ↓ 없으면
   3. null 반환 → dispatch가 PRICE_NOT_CONFIGURED로 기록하고 발송·차감 중단
```

**모호성 차단**
- DB: §C 인덱스가 같은 범위의 `active`를 **1개로 강제**한다.
- 앱: 그럼에도 조회는 `.maybeSingle()`로 한다. 행이 2개면 **에러가 나고, 그 에러를 삼켜
  "첫 번째 행"을 고르지 않는다.** 정책을 못 고르면 발송하지 않는 쪽이 안전하다(fail closed).

**반환값**
```ts
interface ResolvedPricing { policyId: string; unitPrice: number; }   // 단가와 근거를 함께 돌려준다
```
현재 `getUnitPrice()`가 숫자만 돌려주는 것을 이 형태로 바꾸면, `dispatch.ts` 158행 한 곳만
고쳐도 reserve/capture/`message_log`까지 **정책 id가 같이 흐른다**(STEP 1 §5에서 확인).

**역할 분리**
| DB | Resolver |
|---|---|
| active 중복 방지 · 금액/상태 검증 · 변경 보호 · FK 무결성 | tenant 우선 · global fallback · 없음 판단 · dispatch에 결과 전달 |

---

## G. `message_log.price_policy_id`

```sql
alter table message_log
  add column if not exists price_policy_id uuid
    references message_pricing_policies (id) on delete restrict;

create index if not exists idx_message_log_price_policy on message_log (price_policy_id);
```

- **nullable** — 기존 행은 `null`로 남는다. **과거 로그에 역채우기(backfill) 하지 않는다.**
  당시 어떤 정책이었는지 모르는 데이터를 추정해서 채우면 그건 증빙 조작이다.
- **`on delete restrict`** — 한 번이라도 발송에 쓰인 정책은 **지울 수 없다.**
  `tenant_charge`만 있고 정책이 사라지면 "왜 그 금액이었나"가 증발한다. 정책의 정상적인
  마지막 상태는 삭제가 아니라 `retired`다.
- 기존 데이터 영향: **없음**(컬럼 추가만, 타입·값 변경 없음).

---

## H. Migration 계획

```
0060_message_pricing_policies.sql

신규:
  - message_pricing_policies (테이블)
  - uq_pricing_active_scope           (coalesce 기반 부분 unique)
  - idx_pricing_lookup                (owner_username, kind, message_type, provider, status)
  - message_pricing_policies_guard()  + before update 트리거
변경:
  - message_log.price_policy_id  uuid null  references … on delete restrict
  - idx_message_log_price_policy
기존 데이터:
  - 변경 없음. 기존 message_log 행은 price_policy_id = null 유지
  - 운영 가격 정책 seed 없음 ("설정된 가격 정책 없음"이 정상)
RLS:
  - alter table message_pricing_policies enable row level security  (정책 0개, service_role 전용)
  - anon 조회/삽입/수정/삭제 차단을 QA로 실측
rollback (순서 중요):
  1. drop index if exists idx_message_log_price_policy;
  2. alter table message_log drop column if exists price_policy_id;   -- FK가 먼저 사라져야 함
  3. drop trigger if exists trg_message_pricing_policies_guard on message_pricing_policies;
  4. drop function if exists message_pricing_policies_guard();
  5. drop table if exists message_pricing_policies;
적용 전 확인 SQL:
  select to_regclass('public.message_pricing_policies');        -- null 이어야 함
  select count(*) from message_log;                              -- 참고(현재 0)
  select column_name from information_schema.columns
   where table_name='message_log' and column_name='price_policy_id';  -- 없어야 함
```

### H-3. `tenant_id` FK를 두지 않는 이유 (FK 상호작용 분석)

```
tenants 삭제
  → (만약 policies에 tenant_id cascade FK가 있다면) policies 행 cascade DELETE
  → 그 정책을 참조하는 message_log.price_policy_id 는 RESTRICT
  → **테넌트 삭제가 실패한다**
```
그래서 정책은 `owner_username`(text)만 들고, 테넌트 삭제와 생명주기를 묶지 않는다.
가격 정책은 **플랫폼 자산**이고, 테넌트가 사라져도 과거 증빙으로 남아야 한다.
(같은 이유로 `message_log`는 `tenant_id` cascade를 그대로 둔다 — 로그가 사라지면 그 로그의
정책 참조도 함께 사라져 RESTRICT가 걸릴 대상이 없어진다.)

---

## I. 트리거 QA 케이스 (구현 **전에** 확정)

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `active` 정책 `unit_price` 직접 UPDATE | **차단** |
| 2 | `active` 정책 `message_type`/`provider`/`owner` 변경 | **차단** |
| 3 | `active → retired` 전환 | **허용** |
| 4 | `draft → active` 전환 | **허용** |
| 5 | `draft` 상태에서 단가·축 수정 | **허용** |
| 6 | `retired → active` 되살리기 | **차단** |
| 7 | 시스템/FK 유발 UPDATE (예: 다른 테이블 삭제로 인한 연쇄) | **허용** — 현재는 그런 경로가 없음을 실측으로 확인 |
| 8 | 참조된 정책 삭제(로그 존재) | **RESTRICT로 차단** |
| 9 | 참조 없는 `draft`/`retired` 정책 삭제 | **허용** |
| 10 | 같은 범위 `active` 2건 삽입 (테넌트) | **차단** |
| 11 | 같은 범위 `active` 2건 삽입 (**global, owner=null**) | **차단** ← §C의 핵심 |
| 12 | `unit_price <= 0` / 허용 외 `status`·`kind`·`message_type` | **차단** |

---

## J. 최종 질문에 대한 답 — v1/v2 가격 증명 체인

> **"v1으로 발송된 메시지와 v2로 발송된 메시지가 있을 때, v1을 삭제·수정하지 않고 두 거래의
> 가격 근거를 각각 영구히 증명할 수 있는가?"**

**가능하다. 연결 전체는 이렇다.**

```
[DB 제약]
  uq_pricing_active_scope  → 같은 범위의 active는 언제나 1개
  guard 트리거             → active/retired의 단가·축은 불변(수정 자체가 불가능)
  check(unit_price > 0)    → 의미 없는 값이 들어오지 못함
        │
[정책 lifecycle]
  v1 draft → active … 사용 … → retired   (삭제가 아니라 은퇴. 행은 영구히 남는다)
  v2 draft → active                       (v1을 고치는 게 아니라 새로 만든다)
        │
[FK]
  message_log.price_policy_id → policies.id  ON DELETE RESTRICT
  → 한 번이라도 쓰인 정책은 **지울 수 없다**. 증빙이 끊길 경로가 원천 차단된다.
        │
[Resolver]
  발송 시점에 tenant → global 순으로 active 하나를 고르고,
  { policyId, unitPrice }를 함께 반환. 모호하면 고르지 않고 실패(fail closed).
        │
[Dispatch]
  dispatch.ts 158행에서 받은 unitPrice로 reserve → provider → capture/release.
  가격이 없으면 reserve조차 하지 않는다(돈 이동 0, provider 호출 0).
        │
[message_log]
  tenant_charge   = 그때 실제로 차감한 금액   (append 후 금액 변경 경로 없음)
  price_policy_id = 그때 적용된 정책 id       (정책은 삭제 불가·수정 불가)
```

**따라서 시간이 흐른 뒤에도**
- 로그 A → `price_policy_id = v1` → v1 행 조회 → **당시 단가·축·활성 시각 그대로** 확인
- 로그 B → `price_policy_id = v2` → 동일
- v1은 `retired`일 뿐 **존재하고, 값도 그대로**다.
- 반대 방향(가격을 바꿔 과거를 재해석)은 **트리거가 UPDATE를 막고, RESTRICT가 DELETE를 막아**
  구조적으로 불가능하다.

**한계도 명시한다**: 기존 로그(현재 0행, 향후 가격 도입 전 발송분)는 `price_policy_id = null`이라
"금액은 있으나 정책 근거는 없음" 상태다. 이건 **역채우기로 만들지 않는다** — 모르는 것을
아는 것처럼 기록하지 않는 편이 증빙으로서 정직하다.

---

## K. 승인 요청

1. §A DDL + §C 인덱스 + §E 트리거 + §G `message_log.price_policy_id`(RESTRICT) 로 **0060 작성·적용**
2. §F Resolver / Repository 구현 (`PricingPolicyStore`, `resolvePricing`)
3. `dispatch.ts` 158행 연결(단가+정책 id 동시 반환) — **분기 추가 없음**
4. Admin 최소 UI(정책 목록·생성·active/retired 전환) — 차트·매출 분석 없음
5. QA §I 전량 + 가격 v1→v2 변경 후 **과거 로그 불변** 실측 + 회귀 + 보안 + cleanup 0

승인해 주시면 그 범위로만 진행하고, **운영 가격은 여전히 입력하지 않습니다**(정책 없음 = 발송 없음 유지).
