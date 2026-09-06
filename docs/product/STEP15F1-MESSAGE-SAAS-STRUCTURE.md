# STEP15-F1 — 메시지 SaaS 서비스 구조 · 테넌트 설정 · 권한/IA 조사

> 2026-09-05 / CTO. **코드·DB 변경 0.** 구현 전 조사 단계(CPO 지시: 조사 → 충돌·migration 영향 확인 → BLOCKER 없을 때만 구현).
> 전제: 알리고를 기다리지 않고 **주문:한장이 메시지를 운영·판매할 수 있는 SaaS 구조**를 먼저 만든다. 실제 발송·실결제·광고는 연결하지 않는다.

## 1. 기존 구조와의 충돌 — 1건 발견

현재 `app_settings`의 `message_settings:<username>`은 이렇게 생겼다.

```ts
{ enabled: boolean,                    // ← 지금은 "메시지 발송 마스터 스위치"
  events: { ORDER_RECEIVED, DRIVER_ASSIGNED, DELIVERY_COMPLETED },
  senderProfileStatus: "none"|"pending"|"ready",
  stopOnInsufficientBalance: boolean }
```

**충돌**: 이번에 추가할 서비스 활성화 상태(`disabled`/`pending`/`enabled`)와 기존 `enabled`가
의미가 겹친다. 그대로 두면 "서비스는 활성화됐지만 발송은 꺼짐" 같은 상태를 표현할 수 없다.

**해결(마이그레이션 불필요)** — 의미를 분리해 필드를 나눈다.

| 필드 | 의미 | 누가 바꾸나 |
|---|---|---|
| `serviceStatus: "disabled" \| "pending" \| "enabled"` | **서비스 가입 상태**. 약관·정책 확인 후 활성화 | 사장님(활성화) / Admin(정지) |
| `events.*` | 이벤트별 자동 발송 ON/OFF | 사장님 |
| `senderProfileStatus` | 카카오 발신프로필 준비 상태 | 시스템/Admin |
| ~~`enabled`~~ | **폐기** — `serviceStatus === "enabled"`로 대체 | — |

`app_settings`는 JSONB이고 읽을 때 기본값과 병합하므로 **기존 행이 있어도 그대로 동작한다**
(`enabled: true`인 기존 값은 읽을 때 `serviceStatus: "enabled"`로 승격하면 된다).
→ **F1에는 migration이 필요 없다.**

## 2. 테넌트 기능 플래그 — 컬럼이 아니라 설정으로

선례는 `tenants.bag_management`(컬럼)다. 하지만 메시지 서비스 상태는 컬럼으로 두지 않는 것이 맞다.

- 상태가 3개 이상이고 앞으로 늘어난다(정지·해지·미납 등)
- 발신프로필·잔액 부족 정책 등 **함께 다뤄야 할 값이 이미 `message_settings`에 있다**
- 컬럼으로 두면 값이 두 곳에 나뉘어 "무엇이 진실인지"가 흐려진다

→ **`message_settings` JSON 안에서 관리**하고, 나중에 Admin이 전체 테넌트를 훑어야 할 때만
조회 성능을 보고 판단한다(현재 테넌트 수 규모에서는 문제가 되지 않는다).

## 3. 권한 / IA 조사

### 현재 상태
- 라우트 가드(`src/proxy.ts`)는 **driver ↔ 그 외**만 구분한다. admin 전용 라우트는 미들웨어가 아니라 **각 페이지에서 `session.role` 확인 후 redirect**하는 방식이다(`/messages`가 그렇게 되어 있다).
- 네비게이션은 `NAV_ENTRIES`(홈/업무/분석/관리 4섹션) + `NavItem.adminOnly` 플래그. 현재 `adminOnly: true`는 `/messages` 하나뿐이다.

### F1에서 필요한 구조
```
사장님(user)                     Admin
메시지                            메시지 관리
 ├ 발송 설정                       ├ 전체 현황(테넌트별 상태)
 ├ 발송 내역                       ├ 정책 / 단가
 └ 잔액 · 충전                     ├ 테넌트 관리(정지·조정)
                                  └ Provider 상태
```

- 사장님 화면은 **새 라우트가 아니라 같은 `/messages`를 role로 분기**하는 것이 맞다.
  라우트를 둘로 나누면 링크·권한·QA가 두 배가 된다.
- 단, **서비스 미활성 테넌트에게는 메뉴를 노출하지 않는다.** `NAV_ENTRIES`는 정적 배열이라
  "테넌트 설정에 따라 보임/숨김"을 지원하지 않는다 → **`NavItem`에 조건부 노출 개념이 필요**하다
  (`adminOnly`처럼 `requiresMessageService` 같은 플래그, 또는 서버에서 계산한 메뉴 목록 전달).
  이건 nav 렌더링 구조를 건드리므로 F1 구현 시 가장 주의할 지점이다.

### 활성화 흐름 (기본값 OFF 유지)
```
메시지 서비스 미사용(기본)
   → 사장님이 "메시지 서비스 시작" 클릭
   → 정책/비용 안내 + [ ] 내용을 확인했습니다  ← 자동 발송 시 잔액 차감 동의
   → serviceStatus = enabled (이벤트는 여전히 전부 OFF)
   → 이벤트별 ON/OFF는 그 다음 단계
```
**활성화 자체가 발송을 시작하지 않는다.** 이벤트를 켜야 발송 대상이 된다(2단 안전장치).

## 4. F2(Wallet/Ledger) migration 영향 — 사전 검토

F1에는 migration이 없지만, 바로 다음 F2는 필요하다. 미리 영향만 확인해 둔다.

| 항목 | 검토 결과 |
|---|---|
| 테이블 | `message_wallet`(테넌트별 잔액 캐시) + `message_wallet_transactions`(append-only) 2개 신설 |
| 기존 데이터 영향 | **없음** — 기존 테이블 스키마 변경 없이 신설만 |
| `message_log`와의 관계 | `transactions.message_log_id`로 참조. **로그는 "메시지가 어떻게 됐나", Ledger는 "돈이 어떻게 움직였나"** — 역할 중복 없음 |
| rollback | `drop table` 2개. 다른 테이블이 참조하지 않으므로 안전 |
| RLS | 기존 관례대로 `enable row level security` + 정책 0개(서비스 롤 전용) |
| 정합성 | `sum(transactions) == wallet.balance`, `capture 수 == sent 로그 수`, 24h 초과 미확정 `reserve` — 정합성 감사에 추가 후보 |
| 주의 | **잔액을 단일 숫자로 덮어쓰지 않는다.** 캐시 컬럼을 두더라도 진실은 거래 내역이다 |

## 5. 구현 계획 (F1 범위, BLOCKER 없음 확인 시)

1. `message-settings.service.ts` — `serviceStatus` 도입, 기존 `enabled` 읽기 호환 처리
2. 활성화/비활성화 서버 액션 2개(사장님 본인 테넌트만, Admin은 전체)
3. `/messages` role 분기 — 사장님 뷰(발송 설정 / 발송 내역 / 잔액·충전) + Admin 뷰(현황·정책·Provider)
4. 네비게이션 조건부 노출(`serviceStatus !== "disabled"`일 때만 사장님에게 표시)
5. 이벤트 3종 ON/OFF UI(기본 OFF, 확정된 이벤트만)
6. 발송 대상 정책은 **고정 안내 문구로만** 표시(사장님이 매번 고르게 하지 않는다)
7. 잔액/사용량 자리(F2 전까지는 0 표시, 충전 버튼은 `준비 중`)
8. QA: 권한(사장님/Admin/URL 직접 접근) · 활성화 상태 전이 · 이벤트 토글 · 테넌트 격리 · 기존 회귀 · cleanup diff 0

## 6. BLOCKER 판정

| | 상태 |
|---|---|
| 기존 설정 구조 충돌 | **해결 가능**(§1) — migration 불필요 |
| F1 migration 필요 여부 | **불필요** |
| 권한 구조 변경 필요 | **없음** — 기존 role 분기 방식 그대로. 단 nav 조건부 노출은 렌더링 구조를 건드림(정책 변경 아님) |
| 제품 정책 변경 | **없음** — 기본값 OFF 유지, 발송 이벤트는 확정된 3개만 |
| F2 migration | **필요** — 신설 2테이블. 영향·rollback·RLS는 §4에 정리, **승인 후 진행** |

**→ F1은 BLOCKER 없이 구현 가능하다. F2는 승인이 필요하다.**

## 7. 이번 단계에서 하지 않는 것 (재확인)

알리고 실제 API 호출 · 실제 카카오 발송 · 광고/마케팅 발송 · 자동 마케팅 · 고객 수신동의 필드 추가 ·
자유 템플릿 편집기 · 실제 PG 결제 · **가격 숫자 확정** · 구독 플랜 · 무제한 발송.
