# Production 브라우저 QA (Chrome 확장 비의존)

Chrome 확장(claude-in-chrome) 연결 여부와 무관하게, Playwright로 실제 배포 URL을
헤드리스 브라우저로 직접 조작해 핵심 시나리오를 검증한다.

## 실행

```bash
npm run qa:delivery   # https://jumunhanjang.vercel.app 대상 (기본값)
```

로컬 dev 서버 대상으로 돌리려면:

```bash
QA_BASE_URL=http://localhost:3104 npm run qa:delivery
```

`.env.local`(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/AUTH_SECRET)이 필요하다 —
어느 URL을 대상으로 하든 항상 같은 Production Supabase DB에 QA 데이터를 심고 지운다.

## 동작 방식

1. **세션**: 로그인 폼을 거치지 않고, 앱의 `createSessionToken`(서명 로직 재사용)으로
   만든 서명된 세션 쿠키를 Playwright `context.addCookies`로 브라우저에 직접 심는다.
   `document.cookie`로 심는 방식과 달리 `httpOnly` 쿠키도 정상적으로 설정된다.
2. **테스트 데이터**: `user3`(기본 QA tenant, 교차 tenant 격리 검증이 필요한 스크립트는
   보조로 `user4`)에 `QA-`로 시작하는 고객/주문/기사만 만든다. `scripts/safe-scratch.ts`의
   `ALLOWED_TEST_OWNERS`, `scripts/qa/lib/qa-config.ts`의 `FORBIDDEN_QA_OWNERS`
   (`user1`/`user2`, 실제 서비스 이용 중인 tenant)에 없는 tenant는 대상으로 삼을 수 없도록
   막혀 있다.
3. **정리**: 성공/실패와 무관하게 `finally`에서 만든 행의 id만 정확히 지운다(조건절
   삭제 없음). 운행시작/종료로 새로 생긴 `driver_shifts` 행도 원래 없었을 때만 지운다.

## 실행 전 안전장치 (STEP10-4, 2026-08-27 CPO 작업지시)

정적 allowlist(`FORBIDDEN_QA_OWNERS`)만으로는, `user3`/`user4`가 나중에 실제 셀러에게
배정되는 순간을 코드가 자동으로 알 수 없다 — 사람이 설정을 갱신하는 걸 잊으면 QA가 실
데이터를 덮어쓸 수 있다. 그래서 모든 QA 스크립트는 `main()`/`run()` 진입 직후 첫 줄에서
`scripts/qa/lib/qa-guard.ts`의 `assertTenantIsQaSafe(owner)`를 호출한다:

- 대상 tenant에 `QA_NAME_PREFIX`("QA-")로 시작하지 않는 주문/고객/기사가 **단 1건이라도**
  있으면 임계치 없이 즉시 예외를 던지고 스크립트를 중단한다(단순 경고가 아니라 fail-fast).
- `user1`/`user2`는 이 검사 이전에 `assertAllowedQaOwner()`에서 코드 레벨로 무조건 차단된다.
- 새 QA 스크립트를 작성할 때는 반드시 같은 패턴을 따른다: `import { assertTenantIsQaSafe } from "./lib/qa-guard"` →
  진입 함수 첫 줄에서 `await assertTenantIsQaSafe(OWNER)`(교차 tenant 스크립트는 관련된
  모든 owner에 대해 각각 호출) → 이 스크립트가 생성하는 모든 고객명/수령인명/기사명은
  `QA_NAME_PREFIX`로 시작해야 한다.

## Production QA vs Local QA

```bash
npm run qa:delivery                              # Production(https://jumunhanjang.vercel.app) 대상, 기본값
QA_BASE_URL=http://localhost:3104 npm run qa:delivery   # 로컬 dev 서버 대상
```

- 두 경우 모두 `.env.local`에 정의된 **같은 Production Supabase DB**에 QA 데이터를
  심고 지운다(로컬/Production 분리 DB 없음) — `QA_BASE_URL`은 브라우저가 접속하는
  화면(HTTP)만 바꾸고, 데이터가 만들어지는 DB는 바꾸지 않는다.
- 로컬 대상으로 돌리려면 먼저 `npm run dev`(또는 `next dev`)로 로컬 서버가 떠 있어야 한다.
- `import-step2-product-order.ts`처럼 `runImport`/`classifyDuplicates`를 브라우저 없이
  직접 호출하는 스크립트는 `QA_BASE_URL`과 무관하게 항상 같은 DB만 사용한다.

## 새 시나리오 추가

`scripts/qa/delivery-flow.ts`의 `run()` 안에 `record(step, pass, detail)` 호출을
추가하면 된다. 실패 시에만 `detail`이 콘솔/요약에 노출된다.
