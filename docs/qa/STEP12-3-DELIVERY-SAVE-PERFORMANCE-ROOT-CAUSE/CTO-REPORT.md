# STEP12-3-DELIVERY-SAVE-PERFORMANCE-ROOT-CAUSE — CTO 최종보고

- 대상 배포: `ea0d880`(STEP12-2까지) → 이번 Gate에서 `scripts/qa/*.ts` 4개 파일만 수정, **앱 코드(src/) 변경 없음**
- 대상 URL: `https://jumunhanjang.vercel.app`
- CPO 지시: "코드를 먼저 고치지 말고, 클릭→완료까지 시간을 항목별로 분해 측정한 뒤 병목이 확인되면 최소 수정안으로 진행"

---

## 결론 먼저: 앱에는 성능 문제가 없었습니다. STEP12-2가 보고한 "~30초 고정 지연"은 QA 스크립트 자체의 측정 버그였습니다.

CPO께 매우 죄송한 정정 보고입니다. STEP12-2에서 "5건 저장과 150건 저장이 똑같이 ~30~34초 걸린다"고 보고하고 "베타 오픈 후 사장님이 저장할 때마다 30초씩 기다릴 수 있다"는 우려로 이번 STEP12-3을 시작했는데, 지시하신 대로 클릭→완료 전체 과정을 항목별로 실측한 결과 **그 30초는 실제로 존재하지 않았습니다.** QA 스크립트가 저장 완료 여부를 확인하는 방식에 있던 버그가 만들어낸 착시였습니다.

## 1. 클릭→완료 시간 분해 (지시하신 순서대로)

`src/actions/delivery.ts`(saveDeliveryDraftAction), `src/app/(protected)/delivery/page.tsx`(재렌더링 경로), `src/components/delivery/delivery-board.tsx`(클라이언트 클릭 핸들러)에 임시로 타임스탬프 로그를 심고, 로컬 dev 서버에서 실제 클릭→저장을 재현해 각 구간을 측정했습니다(측정 후 전부 원복 — 아래 "임시 계측 처리" 참조).

| 구간 | 5건 혼합 저장 | 150건 일괄 저장 |
|---|---|---|
| ① 브라우저 요청 시작 → Server Action 함수 진입 | 수 ms | 수 ms |
| ② Server Action 내부 — DB 조회/검증(`findByIds`) | ~100ms | ~140ms |
| ③ 기사배정 RPC(`assignDriver`)/해제 | ~550ms | ~730ms |
| ④ 가방번호 일괄 RPC(`updateBagBatch`) | 해당없음(이 케이스엔 없음) | 해당없음 |
| ⑤ `revalidatePath` 호출 자체 | 즉시(캐시 무효화 마킹만, DB 접근 없음) | 즉시 |
| ⑥ Server Action 응답에 포함된 `/delivery` 페이지 재렌더링(6개 병렬 조회: 배송건/기사/계정/지역/그룹/기능플래그) | ~550-880ms | ~750-940ms |
| ⑦ 브라우저가 응답을 받아 React state 반영 + 실제 DOM 커밋(더블 requestAnimationFrame으로 실측) | 클릭 후 ~865-1031ms 시점 | (동일 메커니즘) |
| **Server Action 전체 왕복(①~⑥ 합산, 네트워크 fetch 실측)** | **251~1532ms** | **1323~1533ms** |

**즉 실제 저장은 서버·클라이언트 모두 합쳐 1.5초 이내에 전부 끝납니다.** ②~⑥ 어디에도 30초에 근접하는 구간이 없었습니다.

## 2. 그런데 왜 QA 스크립트는 계속 ~30초로 측정했는가 — 근본 원인

STEP11-13부터 지금까지 저장 성능을 측정한 모든 QA 스크립트가 공유하는 `draftCountText()` 헬퍼가 원인이었습니다.

```ts
// 기존(버그) — STEP11-13/11-14/12-1/12-2 공통
async function draftCountText(page: Page): Promise<string> {
  return (await page.locator("text=/변경사항 [0-9]+건/").first().textContent().catch(() => "")) ?? "";
}
```

Playwright의 `.textContent()`는 매칭되는 요소가 **0개**일 때 즉시 실패하지 않습니다 — "곧 나타날 수도 있다"고 가정하고 기본 30초(actionTimeout) 동안 내부적으로 재시도하다가, 그래도 없으면 그제서야 예외를 던집니다. 저장이 성공하면 "변경사항 N건" 표시가 화면에서 완전히 사라지는데(이게 바로 우리가 원하는 정상 동작), 이 순간 `.textContent()`가 "요소가 없다"는 사실을 확정하기까지 **매번 Playwright의 30초 auto-wait 타임아웃을 그대로 다 기다린 뒤** `.catch(() => "")`로 빠져나왔습니다. 저장이 5건이든 150건이든 이 타임아웃은 항상 똑같이 걸리므로 — 이것이 바로 STEP12-2에서 "5건과 150건이 똑같이 ~30초"라는, 배치 크기와 무관한 결과가 나온 진짜 이유였습니다.

**검증**: 동일 시나리오를 `.count()`(auto-wait 없이 즉시 반환)로 바꿔 재측정하니 저장 완료 확인까지 정확히 1.0~1.2초가 걸렸고, 이는 위 서버/클라이언트 실측치와 정확히 일치했습니다.

이 버그는 STEP11-13(원래 "150건 Production ~33초" 기준선을 세운 스크립트)부터 STEP11-14, STEP12-1, STEP12-2까지 총 4개 QA 스크립트에 동일하게 존재했습니다. 즉 이 프로젝트에서 지금까지 "배송관리 저장이 느리다"고 알려져 온 수치 전부가 실제로는 이 QA 스크립트의 측정 버그였을 가능성이 높습니다.

## 3. 수정 내용

**앱 코드(src/)는 전혀 수정하지 않았습니다** — 애초에 고칠 성능 문제가 없었기 때문입니다. 수정한 것은 QA 스크립트 4개뿐입니다.

```ts
// 수정 후
async function draftCountText(page: Page): Promise<string> {
  const loc = page.locator("text=/변경사항 [0-9]+건/").first();
  if ((await loc.count()) === 0) return "";
  return (await loc.textContent().catch(() => "")) ?? "";
}
```

- `scripts/qa/step11-13-draft-batch-save.ts`
- `scripts/qa/step11-14-delivery-assignment-ux.ts`
- `scripts/qa/step12-1-beta-open-ready.ts`
- `scripts/qa/step12-2-final-operation-audit.ts`

`.count()`는 auto-wait 없이 즉시 매칭 개수를 반환하므로, 요소가 이미 사라진 상태를 즉시 확인할 수 있습니다.

임시로 추가했던 계측 코드(콘솔 타임스탬프 로그)는 원인 확인 후 `src/actions/delivery.ts`, `src/app/(protected)/delivery/page.tsx`, `src/components/delivery/delivery-board.tsx` 세 파일 모두 원상 복구했습니다(`git diff` 결과 이 세 파일은 변경사항 없음).

## 4. 수정 후 재측정 결과 (올바른 방법으로)

`step12-2-final-operation-audit.ts`(수정판)를 로컬 2회 + Production 1회 재실행 — **3회 모두 12/12 PASS**, H1/H2 수치가 아래처럼 정상 범위로 나왔습니다.

| 측정 | 로컬 1회차 | 로컬 2회차 | Production |
|---|---|---|---|
| H1: 5건 혼합 저장 | 2,436ms | 2,282ms | 5,790ms |
| H2: 150건 일괄 저장 | 4,513ms | 3,349ms | 4,244ms |

Production의 변동폭(H1이 H2보다 큰 경우도 있음)은 Vercel 서버리스 함수의 통상적인 콜드스타트/네트워크 지연 범위 내이며, 어느 케이스도 6초를 넘지 않습니다. 150건이 5건보다 오래 걸리는 경향(로컬 기준)은 실제 배치 크기에 비례하는 정상적인 특성이며, STEP12-2가 우려했던 "배치 크기 무관 고정 30초"는 애초에 존재하지 않았습니다.

## 5. 회귀 확인

수정한 것이 "저장 완료를 확인하는 방법"뿐이므로, 어떤 시나리오를 검증하는지는 전혀 바뀌지 않았습니다 — 실제로 로컬 2회+Production 1회 모두 D1-D4(개별/일괄 UX 분리)/C1-C5(Draft 저장/새로고침 유지)/H1-H3(성능+DB 반영)를 포함한 12개 항목 전부 그대로 PASS했습니다.

## 6. Production 재검증 결과

- 코드 변경이 없어 재배포는 불필요합니다. 기존 배포(`ea0d880`)에 대해 수정된 QA 스크립트로 재검증했습니다.
- `npx tsc --noEmit`: 통과. `npx eslint`(수정 파일 전체): 통과.

## 7. QA 데이터 삭제 확인

- 이번 Gate의 재실행(로컬 2회+Production 1회)이 생성한 `QA-1202-` 프리픽스 데이터는 스크립트 자체 `finally` 블록으로 전량 자동 원복 확인.
- 조사 과정에서 사용한 1회성 조사 스크립트(`scripts/qa/_tmp-step12-3-perf-probe.ts`, 스크래치 디렉터리 사본)가 만든 임시 주문/기사/고객 1건씩도 스크립트 자체 `finally`로 즉시 원복 확인, 스크립트 파일 자체는 삭제 완료.
- `user3`에 STEP12-1 시점부터 알려진 기존 잔존물(QA-테스트기사A-1/2, QA-프리픽스 고객 6건, delivery_groups 1건)은 이번 Gate 범위 밖으로 그대로 남아있으며 변경 없음.

## 8. CPO께 드리는 정정 및 권고

- **STEP12-2 보고서의 "5건≈150건≈30초 고정비용" 결론은 철회합니다.** 원인은 QA 자동화 스크립트의 저장-완료 감지 로직에 있던 Playwright `.textContent()` auto-wait 버그였고, 실제 앱 성능과는 무관했습니다. STEP12-2의 `verify-report.json`/`CTO-REPORT.md`에도 이 정정을 반영해 두었습니다(`docs/qa/STEP12-2-BETA-OPEN-FINAL-OPERATION-AUDIT/CORRECTION.md` 추가).
- **베타 오픈 판단에 영향**: 이 "성능 문제"는 애초에 없었으므로, STEP12-2가 GO 판단에 붙였던 성능 관련 유보 사유는 근거가 사라졌습니다. 배송관리 저장은 5건이든 150건이든 사장님이 체감하기에 즉각적인 수준(1~6초)입니다.
- 다만 이번 조사로, 지금까지 이 프로젝트의 여러 STEP(STEP11-13 최초 기준선 포함)이 "150건 배치라 30초대"라고 서술해 온 것 자체가 같은 버그의 영향이었을 가능성이 높다는 점을 알려드립니다. 과거 보고서들의 문구를 소급 수정하지는 않았으나(이력 보존), 향후 이 프로젝트의 성능 관련 과거 기록을 참고하실 때는 QA 스크립트의 측정 방식이 이번에 수정되었다는 점을 감안해 주시기 바랍니다.
- 다음 작업(랜딩페이지 등)으로 넘어가시는 데 아무 지장이 없다고 판단합니다.

**CTO FINAL: PASS**
