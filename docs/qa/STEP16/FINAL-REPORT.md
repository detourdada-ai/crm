# STEP16 — PRE-BETA REAL USE & PERFORMANCE FINALIZATION

> 2026-09-07 / CTO. 신규 기능 0. 알리고·PG·실결제·실발송 0. 가격 숫자 0.

---

## A. hnd1 성능 검증 — **측정하지 못했습니다 (전제 미충족)**

측정 전에 **실제 Function Region을 먼저 확인**했고, 결과는 이렇습니다.

```
GET /            → x-vercel-id: icn1::iad1::…
GET /delivery    → x-vercel-id: icn1::iad1::…      (인증 세션으로 실측)
GET /orders      → x-vercel-id: icn1::iad1::…
GET /messages    → x-vercel-id: icn1::iad1::…
```

- 앞의 `icn1` = 요청을 받은 **엣지**(서울). 가운데 `iad1` = **함수가 실행된 리전**(US East).
- 즉 **아직 hnd1(도쿄)이 아닙니다.** 병목으로 지목했던 `함수(iad1) ↔ DB(도쿄)` 구조가 그대로입니다.

**그래서 지금 5회 측정을 돌리지 않았습니다.** 조건이 바뀌지 않은 상태의 숫자는 기존
baseline(2,029 / 2,132 / 2,269ms)의 재확인일 뿐이고, "재측정했다"는 기록만 남아
나중에 진짜 비교를 흐립니다.

**CEO 확인 요청**: Vercel 프로젝트 설정의 Function Region이 실제로 `hnd1`로 저장됐는지,
그리고 **저장 후 재배포가 있었는지**(리전 변경은 새 배포부터 적용됩니다) 봐주십시오.
바뀐 것이 헤더로 확인되면 **같은 스크립트·같은 건수로 5회 median**을 즉시 측정해
보고하겠습니다. 개선율을 미리 목표로 잡지 않겠습니다.

---

## B. STEP14 실사용 검증 — **접수된 기록 없음**

CEO가 실제 사용 중 발견한 "멈춤 / 되돌아감 / 외부 도구 복귀 / 불안해서 재확인" 기록은
아직 전달받지 못했습니다. **제가 지어내지 않습니다.** 기록이 오면 즉시
`재현 → 원인 → A/B/D 분류 → (A/B면) 수정 → 회귀` 순으로 처리합니다.

다만 이번 회귀를 돌리면서 **제품 동작 자체에서 발견한 것이 1건** 있어 아래에 올립니다.

### 🔴 발견 1건 — 직접수령으로 바꿔도 배송그룹에서 빠지지 않음

| | |
|---|---|
| **상황** | 같은 주소·같은 배송일 2건이 한 배송그룹으로 묶인 상태 |
| **행동** | 그중 1건을 배송관리에서 **직접수령**으로 전환 |
| **기대** | 배송을 나가지 않으므로 그 그룹에서 빠진다 (`delivery_group_id = null`) |
| **실제** | `fulfillment_method=direct_pickup`, `driver_id=null`, `delivery_status=완료`, `route_order=null`까지는 정리되지만 **`delivery_group_id`는 그대로 남는다** |
| **재현** | 재현됨. 20초를 기다려도 수렴하지 않음 → **타이밍이 아니라 실제 동작** |

**원인 (코드 확인)**
```
order-shipments.repository.ts  setFulfillmentMethod()
   direct_pickup → driver_id / delivery_status / completed_at / route_order 만 갱신
                   delivery_group_id 는 건드리지 않음

order-shipments.repository.ts  findEligibleForGrouping()
   "취소 제외 + 좌표 있음"만 거른다 → 직접수령·완료 건도 **그룹 재계산 대상에 계속 포함**
   → delivery-group-regeneration.service 가 order_count = members.length 로 다시 세고,
     centroid(그룹 중심 좌표)와 대표 지역도 그 건을 포함해 계산한다
```

**영향**
- 화면 목록 자체는 안전합니다 — 보드는 `fulfillment_method`/`delivery_status`로 걸러서
  직접수령 건이 배정필요 탭에 남지 않습니다(D8 PASS).
- 대신 **그룹의 건수와 중심 좌표**에 배송을 나가지 않는 건이 섞입니다.
  배송 안 가는 주소가 그룹 중심을 끌어당기면 묶음 기준이 미묘하게 어긋납니다.

**분류: B (UX·정책)** — 명백한 데이터 파손은 아니지만 그룹의 의미가 흐려집니다.
**조치: 하지 않았습니다.** "직접수령 건을 그룹 대상에서 제외한다"는 **제품 정책 결정**이라
STOP 조건에 해당합니다. QA 항목(D6)도 통과시키지 않고 **FAIL로 남겨** 두었습니다.

**CPO 판단 요청** — ① 직접수령 전환 시 그룹에서 즉시 제외 ② 그룹 재계산 후보에서
직접수령·완료 건 제외 ③ 현행 유지. ①②는 같은 방향이고 수정 범위는 작습니다.

---

## C. 전체 최종 회귀 (실제 실행 결과)

### 정적 게이트
`npx tsc --noEmit` **PASS** · `npx eslint .` **PASS** · `npx next build` **PASS**

### 정합성
`data-integrity-audit` — **RED 0 / YELLOW 0 / 52 검사** (회귀 전·후 동일)

### 기능 회귀
| 영역 | 스크립트 | 결과 |
|---|---|---|
| 배송 핵심 사이클 | delivery-flow | 29/29 |
| 일괄저장(draft) | step11-13-draft-batch-save | 38/38 |
| 배송 UI 정리 | step12-11-delivery-ui-cleanup | 28/28 |
| 주문 CRUD | e2e-p2-scenario-c-crud | 16/16 |
| 엑셀(스마트스토어) | e2e-p2-scenario-a | 15/15 |
| 엑셀(표준 템플릿) | e2e-p2-scenario-b | 11/11 |
| 배송방식 전환 | e2e-p2-scenario-d | **9/10** ← 위 발견 1건 |
| 배송그룹 | e2e-p2-scenario-e | 14/14 |
| 기사 사이클 | e2e-p2-scenario-gh | 18/18 |
| 정산 | e2e-p2-scenario-i | 10/10 |
| 주문 접수 범위 | step14-import-scope-default | 26/26 |
| 권한 공격면 | step12-12 | 17/17 |
| 테넌트 격리 | e2e-p3-user4-isolation | 11/11 |
| 메시지 기반 | step15b | 17/17 |
| 메시지 SaaS | step15f1 | 24/24 |
| 발송 엔진 | step15c | 29/29 |
| 지갑·원장 | step15f2 | 24/24 |
| 지갑 접근통제 | step15f2-access-control | 18/18 |
| 결제 경계 | step15f3 | 41/41 |
| Charge Intent | step15f3c | 31/31 |
| 단가 정책 | step15f3d2 | 51/51 |

### 배포
Vercel 성공 · `https://jumunhanjang.vercel.app` **HTTP 200** · git clean.

---

## D. 이번에 고친 QA 노후화 5건 (제품 결함 아님)

전부 **배송보드가 "그룹 카드로 접히는" UI로 바뀐 뒤 스크립트가 옛 화면을 클릭하고 있던** 문제입니다.
assertion을 지우거나 완화하지 않았고, 오히려 **숨어 있던 실패를 드러냈습니다.**

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | step12-12가 클릭 30초 타임아웃으로 **FATAL** | 공지 팝업 핸들러 미등록(다른 스크립트엔 있음) | 모든 페이지에 등록 → 17/17 |
| 2 | scenario B가 '직접수령' 버튼 대기 중 사망 | 행이 그룹 안에 접혀 있어 **체크박스 클릭이 조용히 실패**(`.catch(()=>{})`) | 펼친 뒤 클릭 + 실패를 삼키지 않음 |
| 3 | B9 유령 그룹 1건 | 삭제 직후 **1회만** 셈. 그룹 정리는 재계산이 뒤따름 | 형성을 기다리듯 **소멸도 대기**(끝까지 남으면 여전히 FAIL) |
| 4 | scenario D/E 실패 | 동일한 그룹 접힘 | 펼친 뒤 판정 → E 14/14 |
| 5 | GH·I 일괄배정 실패 | **"배송기사" 버튼을 거치는 옛 UI**를 클릭. 현재는 콤보박스가 바로 뜨고 draft라 "변경사항 저장"까지 필요 | 현재 흐름으로 교정 → 18/18, 10/10 |

> 공통 교훈: **실패를 `.catch(()=>{})`로 삼키면, 원인은 몇 줄 뒤 엉뚱한 타임아웃으로 나타난다.**
> 이번에 만진 곳들은 실패가 그 자리에서 드러나게 바꿨습니다.

---

## E. 금지 항목 준수

```
알리고 연동 0 · PG 실결제 0 · 실제 메시지 발송 0 · 가격 숫자 0
VAT 결정 0 · 충전 UI 0 · 신규 기능 0 · CLOSED 영역 재개발 0
```

## F. 남은 것

| | 상태 |
|---|---|
| hnd1 재측정 | **CEO의 리전 적용 확인 후 즉시** |
| STEP14 실사용 기록 | **CEO 기록 대기** |
| 직접수령↔그룹 정책 | **CPO 판단 대기** |
| 알리고 / PG 회신 | 외부 대기 |
