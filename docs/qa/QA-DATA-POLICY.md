# QA 데이터 보존/정리 기준 (QA Data Retention & Cleanup Policy)

> Sprint S13(2026-09-03, CPO 작업지시)에서 확정. 이 문서가 QA 데이터의
> 생성·식별·정리에 대한 단일 기준이다. 새 QA 스크립트를 쓰거나 잔존 데이터를
> 정리할 때 반드시 이 문서를 먼저 따른다.

## 0. 최우선 원칙

> **실제 기존 데이터와 구분되지 않는 데이터는 "QA 데이터"라고 추정해서 삭제하지 않는다.**

구분이 되지 않으면 그것은 "QA 데이터일 가능성이 있는 데이터"가 아니라 **"실데이터로
취급해야 하는 데이터"**다. 판단이 애매하면 삭제하지 않고 CPO 판단으로 넘긴다.
이 원칙은 `scripts/qa/lib/qa-guard.ts`의 "기존 데이터 삭제 금지는 절대 원칙"과 같은 규칙이다.

## 1. 테넌트 구분

| 테넌트 | 성격 | QA 쓰기 | QA 조회 |
|---|---|---|---|
| `user1` | 실제 서비스 계정 | 절대 금지 | 금지 |
| `user2` | 사장님/CPO 실사용 테스트 계정 | 절대 금지 | 금지 |
| `user3` | CTO 기본 QA 테넌트 | 허용 | 허용 |
| `user4` | **실제 업무 데이터 확인됨(S13)** — QA 쓰기 금지 | 금지 | 읽기 전용 허용 |
| `user5` | **실제 업무 데이터 확인됨(S13)** — QA 쓰기 금지 | 금지 | 읽기 전용 허용 |

STEP12-17(2026-09-03)부터 **기본 거부(Default Deny)** 다 — QA 쓰기가 허용되는 tenant는
`user3` 하나뿐이고, 목록에 없는 tenant에 쓰려 하면 스크립트가 즉시 예외로 중단된다.
두 번째 tenant가 필요한 QA(교차 격리/병합/권한)는 CPO가 전용 QA tenant를 만들어줄
때까지 실행되지 않는 것이 의도된 동작이다.

코드 레벨 강제: `scripts/safe-scratch.ts`의 `ALLOWED_TEST_OWNERS`,
`scripts/qa/lib/qa-config.ts`의 `FORBIDDEN_QA_OWNERS`,
`scripts/qa/lib/qa-guard.ts`의 `assertAllowedQaOwner()`.

**중요:** "QA 테넌트"라는 것은 *QA를 실행해도 되는 곳*이라는 뜻이지,
*그 안의 모든 데이터가 QA 데이터*라는 뜻이 아니다. §3 참조.

## 2. QA 데이터 식별 규칙 (생성 시)

모든 QA 스크립트가 만드는 고객명/수취인명/기사명은 다음을 만족해야 한다.

1. **접두사**: `QA_NAME_PREFIX`(= `"QA-"`)로 시작한다 — `scripts/qa/lib/qa-config.ts`.
2. **실행 태그**: `makeRunTag(scriptName)`이 만드는 `QA-{script}-{timestamp}` 형식을 이름에 포함한다 — `scripts/qa/lib/qa-guard.ts`.
3. **정리 범위**: cleanup은 반드시 그 실행의 RUN_TAG로만 좁혀서 지운다. `owner_username` 전체 삭제 금지.

이 3가지를 지키면 나중에 잔존 데이터를 봤을 때 아래를 이름만으로 역추적할 수 있다.

```
QA-step12-11-delivery-ui-cleanup-1788219164115-3
   └ scenario ──────────────────┘ └ created_at(ms) ┘ └ seq
```

| 필요한 정보 | 어디서 얻는가 |
|---|---|
| tenant | row의 `owner_username` |
| scenario | 이름 안의 스크립트명 (RUN_TAG) |
| created_at | row의 `created_at` 컬럼 + RUN_TAG의 timestamp |
| qa_identifier | RUN_TAG 문자열 전체 |

**새 DB 컬럼을 추가하지 않는다.** 위 4가지는 기존 구조(이름 + `created_at` +
`owner_username`)만으로 충족된다.

### 업로드 파일 규칙
QA가 만드는 Excel/CSV는 파일명에 RUN_TAG를 넣는다(예: `p4-stress-{RUN_TAG}.xlsx`,
`smartstore-{RUN_TAG}.xlsx`). 실제 스토어에서 내려받은 원본 파일명
(`스마트스토어_전체주문발주발송관리_YYYYMMDD_HHMM.xlsx` 등)을 QA에 그대로 쓰지 않는다 —
`imports.file_name`이 QA/실데이터 구분의 2차 근거이기 때문이다.

## 3. 정리(cleanup) 판정 기준

잔존 데이터를 발견하면 아래 3분류로 판정하고, 🟢만 삭제한다.

### 🟢 삭제 가능
아래를 **모두** 만족할 때만.
- `owner_username`이 `user3`(QA 쓰기가 허용된 유일한 tenant)
- 이름(고객/수취인/기사)이 `QA-` 접두사로 시작
- 실제 업무 데이터로 볼 근거가 없음(실명·실전화·실제 스토어 export 파일 없음)
- 과거 QA 보고서가 그 **row 자체**를 증거로 참조하지 않음

### 🟡 확인 필요 / 보존
- QA 접두사가 없지만 QA 테넌트에 있는 데이터
- 실사업자 롤플레이 시나리오로 쌓인 데이터
- 다른 QA 데이터와 FK로 얽혀 있어 삭제 영향 범위가 불명확한 데이터
→ **삭제하지 않고 CPO 판단으로 넘긴다.**

### 🔴 삭제 금지
- `user1`/`user2` 소유 데이터 (조회조차 하지 않는다)
- 실명 + 실전화번호 + 실제 스토어 export 근거가 있는 데이터
- 과거 QA 보고서가 재현 근거로 참조하는 데이터

## 4. 삭제 절차 (🟢 확정 시)

`AGENTS.md`의 Production DB 안전 규칙을 따르되, **영구 정리**는 4단계 중 "자동 원복"을
스냅샷 보존으로 대체한다(원복하면 정리 자체가 무의미하므로).

1. **스냅샷** — 삭제 대상 전 row를 JSON으로 스크래치 디렉터리에 저장. 콘솔 출력로 대체 금지.
2. **가드** — QA 접두사가 아닌 row가 하나라도 섞여 있으면 전체 중단(abort).
3. **FK 역순 삭제** — 아래 순서를 지킨다.
   ```
   merge_history → customer_change_logs → order_items → order_shipments
   → orders → delivery_groups → duplicate_candidates → customers
   → settlements → driver_shifts → driver_regions → app_accounts → drivers
   → imports
   ```
4. **검증** — 재조회로 잔존 0건 + orphan 0건 확인. 다른 테넌트 건수 무변동 확인.

## 5. QA 스크립트 자산 취급

QA 스크립트는 "임시 파일"이 아니라 **저장소 자산**이다(S13 확정).
- 보고서(`docs/qa/**`)가 증거로 인용하거나, 재실행 가능한 회귀 검증이면 커밋한다.
- 그 턴에 만들어 실행하고 끝나는 진짜 일회성 스크래치만 삭제한다.
- 저장소에 편입된 QA 스크립트는 `tsc`뿐 아니라 **ESLint도 통과**해야 한다.
- 목록/용도는 [QA-SCRIPT-INVENTORY.md](./QA-SCRIPT-INVENTORY.md) 참조.

## 6. 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-03 | Sprint S13에서 최초 제정. `user3` QA 잔존 163건 정리, `user4`/`user5` 1,852건 보존 판정. |
| 2026-09-03 | STEP12-17: QA 쓰기 tenant를 `user3` 하나로 좁힘(기본 거부). 배송그룹 정리를 id 지정 방식으로 교체(`cleanupQaDeliveryGroups`). 정합성 감사 스크립트 추가. |
