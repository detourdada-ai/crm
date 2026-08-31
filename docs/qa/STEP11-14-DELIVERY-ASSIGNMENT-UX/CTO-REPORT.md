# CTO REPORT — STEP11-14-DELIVERY-ASSIGNMENT-UX

## 1. Gate 정보

| 항목 | 내용 |
|---|---|
| Gate ID | STEP11-14-DELIVERY-ASSIGNMENT-UX |
| 목적 | 배송관리의 "개별 입력(기본)"과 "체크박스/그룹 일괄배정(보조)" 두 방식의 역할을 UX로 명확히 분리 + 금일 업데이트 공지사항(최신 1건 노출) 추가 |
| 우선순위 | P0 (CPO 지정) |
| 범위 제한 | CPO 명시: 신규 기능/서버 로직/Draft 배치저장 구조/그룹 알고리즘/지오코딩 변경 금지 — UI 정리 + 문구/노출조건만 |
| 커밋 | `1a45796` |
| 배포 확인 | local HEAD `1a457968a0b27c43b2f73cb2f4d364e3d3404123` == `origin/main` == Vercel 배포 커밋, GitHub status API `state: success` 확인 |

## 2. Before / After

**Before**
- 체크박스로 선택하면 `BulkAssignBar`가 나타났지만, 선택 해제 수단이 없어 계속 선택 상태로 남아있기 쉬웠다.
- "일괄 적용" 버튼이 실제로는 서버 저장이 아니라 Draft 반영일 뿐인데, 그 사실이 버튼 문구/화면 어디에도 명시돼 있지 않아 "적용 = 완료"로 오인하기 쉬웠다(STEP11-13에서 Draft 구조로 바뀐 이후 UX 문구가 따라가지 못한 잔재).
- 그룹 헤더의 "이 그룹 N건 선택" 체크박스가 다른 보조 텍스트와 같은 톤(`text-xs text-muted-foreground`)으로 눈에 띄지 않았다.

**After**
- `BulkAssignBar`(선택 0건이면 렌더 자체를 안 함 — 기존 로직 유지·강화)에 **"선택 해제"** 버튼 추가 → 언제든 개별 입력 화면으로 즉시 복귀 가능.
- 적용 버튼 문구를 `선택한 N건 일괄 적용`으로 바꾸고, 배송기사 모드일 때 바로 아래 보조문구 `적용은 화면에만 반영됩니다 — 변경사항 저장을 눌러야 서버에 저장됩니다`를 추가해 "적용≠저장"을 명시.
- 그룹 헤더 체크박스 라벨을 `text-sm font-medium text-primary`로 강조해 "체크→선택→일괄적용" 흐름임을 더 잘 드러냄.
- 개별 입력(기사 배정/가방번호/회수)과 Draft/배치저장 서버 로직은 STEP11-13 그대로 — 이번 Gate는 UI 문구·노출조건만 변경(코드 diff로 확인, 서버 액션 파일 무변경).
- 공지사항: `/announcements`가 "게시판"이 아니라 **게시중인 것 중 최신 1건만** 보여주도록 리포지토리 쿼리 자체에서 강제(`findLatestPublished()`, `LIMIT 1`). 공지 상세 하단에 `공지사항으로` 링크 추가.

## 3. 개별 vs 일괄 역할 분리 검증

| 확인 항목 | 결과 |
|---|---|
| 선택 0건 → 일괄배정 바 완전히 숨김("선택 해제" 버튼 존재 여부로 판정) | PASS (UI1) |
| 개별 기사배정+가방번호 연속 입력 시 서버요청 0회(대기 없음) | PASS (A1, A2) |
| 그룹 체크 → 일괄배정 바 등장 + "N건 선택" 정확 표시 | PASS (D1) |
| "일괄 적용" 클릭도 즉시 서버저장 아님(Draft 반영, 요청 0회) | PASS (D2) |
| 적용 후 선택이 자동 해제되어 바가 사라짐(같은 방식 재사용 확인) | PASS (D3) |
| 체크박스 단독 선택도 동일한 BulkAssignBar 재사용 | PASS (D4) |
| "선택 해제" 클릭 → 즉시 개별 입력 화면으로 복귀, 각 행 체크박스도 해제 | PASS (F1-F3) |

## 4. 혼합 시나리오(D, CPO가 가장 중요하다고 지정) 검증

그룹 3건(driverA 일괄적용) + 체크박스 2건(driverC 일괄적용) + 개별 1건(driverB, 가방번호 포함) + Scenario A에서 이미 만든 미저장 개별 1건(driverB) = 총 7건의 서로 다른 근원의 변경사항이 **하나의 Draft**로 합쳐졌고, "변경사항 저장" 클릭 시 **서버요청이 정확히 1회**만 발생했으며 DB에 전부 정확히 반영됨을 확인.

- D5. 그룹3+체크2+개별1+미저장개별1 = 변경사항 7건 — PASS
- D6. 최종 저장 서버요청 정확히 1회 — PASS
- D7. DB 반영(그룹 3건=driverA, 체크 2건=driverC, 개별 2건=driverB, 가방번호 포함) — PASS
- D8. 저장 후 변경사항 바 사라짐 — PASS

수정(Scenario E) 시나리오: 같은 건을 driverA→driverB로 두 번 바꿔도 변경사항은 1건으로만 집계되고, 저장 후 DB에는 **최종값(driverB)만** 반영됨(중간값 유실 없이 정확히 마지막 선택만 저장) — PASS (E1, E2).

## 5. 서버요청 0건 증명 / 최종 저장 정확성

`next-action` HTTP 헤더가 붙은 POST 요청 수를 Playwright로 실측하는 기존 STEP11-13 방식을 그대로 사용:

```
개별 입력(기사+가방번호, 2필드) 연속 조작        → 0회
그룹 일괄적용(3건)                              → 0회
체크박스 일괄적용(2건)                          → 0회
그룹3+체크2+개별2(7건, shipment 단위) 최종 저장  → 정확히 1회
```

STEP11-13이 이미 검증한 Draft/배치저장 서버 로직(assignDriver 배치, bulk_update_shipment_bag RPC)은 이번 Gate에서 전혀 수정하지 않았으므로, 이번 검증은 "UX 정리 이후에도 그 로직이 깨지지 않았는지"에 초점을 맞췄다 — STEP11-13 원본 38개 시나리오 전체를 재실행해 회귀가 없음을 별도로 확인했다(6절).

## 6. 자동 QA — 실제 명령과 결과

```
npx tsc --noEmit                     → 0 errors
npx eslint .                         → 0 errors, 0 warnings
npm run build                        → success

npx tsx scripts/qa/step11-14-delivery-assignment-ux.ts   (local, http://localhost:3104)
  ===== SUMMARY ===== 16 / 16 PASS

npx tsx scripts/qa/step11-14-delivery-assignment-ux.ts   (Production, https://jumunhanjang.vercel.app)
  ===== SUMMARY ===== 16 / 16 PASS

회귀 — STEP11-13 Draft/일괄저장 38개 시나리오 재실행(버튼 문구 변경 후에도
"일괄 적용" 문자열이 substring으로 남아있어 기존 QA 로케이터 호환 확인):
npx tsx scripts/qa/step11-13-draft-batch-save.ts   (local)      → 38 / 38 PASS
npx tsx scripts/qa/step11-13-draft-batch-save.ts   (Production) → 38 / 38 PASS
  (I2. 150건 일괄저장 소요 32805ms, 서버요청 1회 — 기존 STEP11-13 대비 동일한 성능 특성 유지)

공지사항 기능 검증(실 계정 user3, role=user 기준, Production):
  1. 로그인 후 팝업에 최신 공지 노출                      — PASS
  2. 팝업 "자세히 보기" → 상세 페이지 이동                 — PASS
  3. 상세 페이지 하단 "공지사항으로" 링크 존재             — PASS
  4. "공지사항으로" 클릭 → /announcements로 이동           — PASS
  5. /announcements에 최신 공지 제목이 정확히 1번만 노출   — PASS
  6. 목록 클릭 없이 바로 본문까지 확인 가능(게시판 아님)   — PASS
  7. 모바일(390px)에서도 제목/본문 정상 노출               — PASS
  8. 일반 사장님 계정에는 Admin 전용 "공지관리" 탭 비노출  — PASS
  합계: 8 / 8 PASS
```

## 7. 실기기 검증 필요 여부

불필요. 배송관리(PC 위주 업무화면) UI 문구/노출조건 변경이며, 기사 앱(모바일)은 이번 변경 대상이 아니다. 공지사항 화면은 모바일 뷰포트(390×844)로 Playwright에서 별도 확인 완료(6절 항목 7).

## 8. Root Cause (QA 스크립트 자체 이슈, 앱 결함 아님)

이번 작업 중 새로 작성한 QA 스크립트(`step11-14-delivery-assignment-ux.ts`, 임시 검증 스크립트)에서 3건의 자체 버그를 발견·수정했다 — 전부 테스트 로직 문제이며 앱 코드에는 영향 없음.

| 이슈 | 원인 | 조치 |
|---|---|---|
| "선택 0건일 때 바 안 보임" 체크가 계속 실패 | `getByText("건 선택")` 부분일치가 그룹 헤더의 "이 그룹 N건 선택" 라벨 및 그 조상 요소까지 중복으로 잡음 | "선택 해제" 버튼(BulkAssignBar에만 존재하는 유일 요소) 존재 여부로 판정하도록 교체 |
| 혼합 시나리오 D 변경건수 기대값 불일치(6건 기대, 7건 실제) | Scenario A에서 만든 개별 변경사항을 저장하지 않은 채 D로 넘어가 Draft에 그대로 누적되고 있었음(테스트 설계 누락) | 기대값을 실제 동작에 맞게 7건으로 수정 — 앱은 처음부터 정확했음 |
| 공지 상세 페이지 "공지사항으로" 링크를 못 찾음 | Radix Dialog가 닫히는 애니메이션 중 배경 콘텐츠의 `aria-hidden`이 비동기로 해제되어, 클릭 직후 `getByRole`이 일시적으로 찾지 못함(qa-popup-guard.ts에 이미 문서화된 동일 패턴) | role 기반 조회 대신 DOM 텍스트 매칭으로 전환 + 짧은 대기 추가 |

## 9. P0/P1/P2 분류

| 등급 | 항목 | 상태 |
|---|---|---|
| P0 | 개별 입력이 기본, 선택은 보조라는 원칙이 실제 화면 동작과 일치 | 완료, 16/16 PASS |
| P0 | 혼합 작업(그룹+체크박스+개별)도 최종 저장 1회로 정확히 반영 | 완료, D 시나리오 PASS |
| P0 | "적용"과 "저장"의 의미 구분(문구로 명시) | 완료 |
| P0 | 공지사항 최신 1건만 노출 + 상세 하단 복귀 링크 | 완료, 8/8 PASS |
| P1 | 그룹 체크박스 라벨 시각적 강조 | 완료(스타일 조정) |
| P2 | 기존 QA 스크립트 13개가 "일괄 적용" 텍스트로 버튼을 찾고 있어 문구를 전부 새로 바꾸지 못하고 "선택한 N건 일괄 적용"으로 절충 — 완전한 문구 자유도보다 회귀 스위트 호환을 우선 | 의도된 절충, CPO 재검토 필요 시 별도 지시 요망 |

## 10. 최종 판정

- STEP11-14 신규 시나리오: **Local 16/16 PASS, Production 16/16 PASS**
- STEP11-13 회귀(Draft/배치저장 38개 시나리오): **Local 38/38 PASS, Production 38/38 PASS**
- 공지사항 기능 검증: **Production 8/8 PASS**
- `tsc`/`eslint`/`build`: 전부 clean
- 배포 확인: local HEAD == origin/main == Vercel 배포 커밋(`1a45796`, status: success) 일치
- 실제 공지 "📢 배송관리 기능이 더 편리해졌습니다"를 admin 관리자 화면을 통해 Production에 게시 완료(사장님 계정에 실제 노출 확인됨)

**CTO FINAL: PASS**
