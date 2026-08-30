# CTO REPORT — STEP11-13-DELIVERY-DRAFT-BATCH-SAVE

## 1. Gate 정보

| 항목 | 내용 |
|---|---|
| Gate ID | STEP11-13-DELIVERY-DRAFT-BATCH-SAVE |
| 목적 | 배송관리 화면의 기사배정/가방번호/회수여부를 "필드마다 즉시 서버 저장"에서 "로컬 Draft → 일괄 저장" 구조로 전환 |
| 우선순위 | P0 (CPO 지정) |
| 커밋 | `845aba6`(본 구현) → `c6d6e78`(네트워크 실패 방어) → `c330e08`(QA 폴링 견고화) |
| 배포 확인 | local HEAD `c330e083f796cc2f0133def1ab35fab079a7825e` == `origin/main` == Vercel 배포 커밋, GitHub status API `state: success` 3-way 일치 확인 완료 |

## 2. 변경사항 (Before/After)

**Before (즉시저장 모델)**
- 기사 변경, 가방번호 입력, 회수여부 토글 — 각 필드를 조작하는 즉시 개별 Server Action 호출 → DB UPDATE 1회.
- 여러 건을 연속으로 고치면 건마다 네트워크 왕복 발생(N건 = N회 요청).
- 화면을 이탈/새로고침해도 "저장 안 된 변경사항이 있다"는 개념 자체가 없음(즉시 저장이므로) — 다만 저장 요청이 실패해도 사용자가 알아채기 어려운 케이스가 존재했음.

**After (Draft/배치저장 모델)**
- 기사배정/가방번호/회수여부 변경은 전부 로컬 `drafts: Map<rowKey, ShipmentDraft>`에만 기록되고, 화면은 `applyDraftToOrder()`로 즉시 반영되지만 서버에는 아직 아무것도 전송되지 않음.
- 원래 값으로 되돌리면 해당 필드가 Draft에서 자동 제거됨(불필요한 diff 방지).
- 상단에 "변경사항 N건" 배너가 나타나고, `전체 되돌리기`(로컬 폐기) / `변경사항 저장`(일괄 커밋) 두 버튼 제공.
- 저장 시 변경 건을 대상 기사별로 그룹핑해 기존 `assignDriver`/`unassignDriver` 배치 메서드로 1회씩, 가방필드 변경은 신규 RPC `bulk_update_shipment_bag`로 전체를 1회에 처리 — 임의의 건수를 항상 **서버요청 정확히 1회**로 커밋.
- 부분 실패 시 성공한 항목은 Draft에서 제거되고, 실패한 항목만 Draft에 남아 재저장 가능(자동 폐기되지 않음).
- 저장 안 된 Draft가 있는 상태에서 브라우저 탭 닫기/새로고침 시 네이티브 `beforeunload` 경고, 화면 내 조회/초기화/상태탭 이동 시 `window.confirm` 경고 — "조용히 사라지는" 경로를 전부 차단.
- 그룹(배송그룹) 배정과 개별 override가 혼합된 경우에도 동일하게 Draft에 쌓였다가 1회 저장.

## 3. QA 결과표 — STEP11-13 전용 시나리오 (CPO 지정 A~I, 총 38개 체크)

| 시나리오 | 내용 | Local | Production |
|---|---|---|---|
| A (A1-A5) | 개별 기사배정 3건 → Draft만 반영, 저장 전 서버요청 0회 → 저장 시 정확히 1회 → DB 정확 반영 → Draft 비워짐 | PASS 5/5 | PASS 5/5 |
| B (B1-B2) | 가방번호/회수여부 변경 → Draft 반영 → 저장 후 DB 반영 | PASS 2/2 | PASS 2/2 |
| C (C1-C5) | 그룹 일괄적용 + 개별 override 혼합 → 저장 서버요청 1회 | PASS 5/5 | PASS 5/5 |
| D (D1-D4) | 그룹 대상 + 개별 대상 혼합 저장도 서버요청 1회 | PASS 4/4 | PASS 4/4 |
| E (E1-E6) | 미저장 상태에서 조회/초기화/상태탭 이동 시 confirm 경고, 취소 시 Draft 보존 | PASS 6/6 | PASS 6/6 |
| F | (E에 통합 — 필터 변경 시나리오) | PASS | PASS |
| G (G1-G5) | 부분 실패 시 성공 건은 커밋, 실패 건만 Draft 잔존·재저장 가능 | PASS 5/5 | PASS 5/5 |
| H (H1-H3) | beforeunload 네이티브 경고 등록/해제 상태 검증(합성 이벤트로 실제 핸들러 로직 검증) | PASS 3/3 | PASS 3/3 |
| I (I1-I3) | 150건 대량 전체선택+일괄적용+저장 — 서버요청 1회, DB 전건 정확 | PASS 3/3 | PASS 3/3 |
| **합계** | | **PASS 38/38** | **PASS 38/38** |

## 4. P0/P1/P2 분류표

| 등급 | 항목 | 상태 |
|---|---|---|
| P0 | Draft 배치저장 구조 자체(기사/가방/회수) | 완료, 38/38 PASS |
| P0 | 미저장 변경사항 이탈 방지(새로고침/탭닫기/화면이동) | 완료, E/H 시나리오 PASS |
| P0 | 부분 실패 시 실패 건만 재저장 가능(성공 건 유실 없음) | 완료, G 시나리오 PASS |
| P0 | 네트워크 실패 시 에러 무시하고 조용히 사라지는 것 방지 | 실측으로 발견 후 수정 완료 (`c6d6e78`, 5절 참조) |
| P1 | 대량(150건) 처리 시에도 요청 1회 유지 | 완료, I 시나리오 PASS. 단 Production 소요시간이 로컬 대비 크게 길어짐(6절 성능 참조, 차단 사유는 아님) |
| P2 | `delivery-group-ux-flow.ts` Case3/4 사전 존재 테스트-알고리즘 불일치 | STEP11-13 범위 밖으로 확인, `spawn_task`로 별도 이관(`task_c714d2f6`) — 이번 Gate 판정에 영향 없음 |

## 5. 자동 QA — 실제 명령과 결과

```
npx tsc --noEmit                     → 0 errors
npx eslint .                         → 0 errors, 0 warnings
npm run build                        → success

npx tsx scripts/qa/step11-13-draft-batch-save.ts   (local, http://localhost:3000)
  ===== SUMMARY ===== PASS 38 / 38

npx tsx scripts/qa/step11-13-draft-batch-save.ts   (Production, https://jumunhanjang.vercel.app)
  ===== SUMMARY ===== PASS 38 / 38

회귀 스위트 (Production 기준, STEP11-13 변경으로 인한 회귀 여부 확인):
npx tsx scripts/qa/delivery-flow.ts                 → PASS 29 / 29
npx tsx scripts/qa/delivery-group-performance.ts    → PASS 46 / 46
npx tsx scripts/qa/delivery-group-partial-failure.ts → PASS 17 / 17
합계: PASS 92 / 92, FAIL 0
```

**Production 실검증 과정에서 발견·조치한 실제 이슈 (테스트로 찾아낸 진짜 앱 결함)**

1차 Production 실행에서 A4/A5/B1/B2/C2/C3가 FAIL — 클라이언트는 "저장 성공"처럼 보였으나 DB에는 반영되지 않은 케이스 확인. `handleSaveDrafts`(`delivery-board.tsx`)에 `try/catch`가 없어, Server Action 호출이 reject되면(네트워크 오류·타임아웃 등) 에러 토스트도 없이 Draft만 사라지는 "조용히 사라지는" 결함을 실제로 재현. 이는 CPO가 명시적으로 금지한 실패 모드와 동일 패턴이라 즉시 수정(`c6d6e78`) — reject 시 에러 토스트를 띄우고 Draft를 보존해 재시도 가능하게 함.

수정 후에도 재현이 들쭉날쭉해 4개의 격리 진단 스크립트(단일건/3건 혼합/가방필드만/혼합 반복 4회)로 재조사한 결과, **서버 저장 로직 자체는 모든 반복 시도(10회 이상)에서 100% 정확했고**, 실패처럼 보인 원인은 QA 스크립트가 Production의 가변적인(때로는 로컬보다 훨씬 느린) 응답 시간을 기다리지 않고 고정 시간(`waitForTimeout`)만 대기한 뒤 판정했기 때문임을 확인. QA 스크립트를 고정 대기 대신 "변경사항 N건" 텍스트가 실제로 바뀔 때까지 최대 25초 폴링하는 방식(`waitForSaveToSettle`)으로 교체(`c330e08`) → 이후 재실행에서 flaky 현상 완전히 사라지고 38/38 안정적으로 PASS.

결론: `c6d6e78`의 네트워크 방어 코드는 실제 방어 가치가 있어 유지하지만, 이번에 반복 관찰된 "저장 실패처럼 보인" 현상의 실질적 원인은 앱 버그가 아니라 QA 스크립트의 대기시간 가정이 틀렸던 것.

## 6. 실기기 검증 필요 여부

불필요. 이번 변경은 배송관리(데스크톱/PC 위주 사용 화면) 로직 변경이며, 기사 앱(모바일)은 이번 Gate의 변경 대상에 포함되지 않음. Playwright 기반 브라우저 자동화로 Local/Production 양쪽 모두 실제 DOM 조작·서버 응답·DB 반영까지 전부 검증 완료.

**참고용 성능 특성 (차단 사유 아님, CPO 인지 필요)**: 150건 일괄 배정 후 저장 시 서버요청은 로컬/Production 모두 정확히 1회로 동일하나, 소요시간은 로컬 약 3.4초인 반면 Production은 약 33초(`I2. 150건 일괄저장 서버요청 1회(소요 32955ms)`)로 크게 김. 반복 측정에서도 정확도는 100% 유지되어 기능적 결함은 아니나, 실제 사용자가 대량(100건 이상)을 한 번에 저장할 경우 로딩 상태에서 수십 초 대기가 발생할 수 있다는 점은 참고 필요.

## 7. Root Cause 정리

| 이슈 | Root Cause | 조치 |
|---|---|---|
| Production 저장 "실패"처럼 보임 (1차) | `handleSaveDrafts`에 reject 방어 없음 → 네트워크 실패 시 무음 실패 | `try/catch` 추가, 에러 토스트 + Draft 보존 (`c6d6e78`) |
| Production 저장 "실패"처럼 보임 (재발) | QA 스크립트 고정 대기시간이 Production의 가변 응답시간보다 짧음 | 폴링 대기로 QA 스크립트 견고화 (`c330e08`), 서버 로직은 원래부터 정상이었음을 확인 |
| `delivery-group-ux-flow.ts` Case3/4 실패 | STEP11-11에서 그룹핑 알고리즘(건물명 우선순위) 변경 이후 테스트 기대값이 갱신되지 않음 — STEP11-13과 무관(코드 diff로 확인) | 범위 밖으로 판단, `spawn_task`(`task_c714d2f6`)로 별도 이관, 본 Gate 판정에 영향 없음 |

## 8. 최종 판정

- STEP11-13 신규 시나리오: **Local 38/38 PASS, Production 38/38 PASS**
- 회귀 스위트(delivery-flow/group-performance/group-partial-failure): **Production 92/92 PASS, 회귀 없음**
- `tsc`/`eslint`/`build`: 전부 clean
- 실측 테스트로 진짜 앱 결함(네트워크 실패 무음 처리) 1건 발견 → 수정 완료 및 재검증 통과
- 배포 확인: local HEAD == origin/main == Vercel 배포 커밋(`c330e08`, status: success) 3-way 일치

**CTO FINAL: PASS**
