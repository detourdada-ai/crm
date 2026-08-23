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
2. **테스트 데이터**: `user2`(테스트 tenant)에 `QA-CPO-`로 시작하는 고객/주문/배송건만
   만든다(`scripts/qa/lib/qa-data.ts`). `scripts/safe-scratch.ts`의
   `ALLOWED_TEST_OWNERS`에 없는 tenant는 대상으로 삼을 수 없도록 막혀 있다.
3. **정리**: 성공/실패와 무관하게 `finally`에서 만든 행의 id만 정확히 지운다(조건절
   삭제 없음). 운행시작/종료로 새로 생긴 `driver_shifts` 행도 원래 없었을 때만 지운다.

## 새 시나리오 추가

`scripts/qa/delivery-flow.ts`의 `run()` 안에 `record(step, pass, detail)` 호출을
추가하면 된다. 실패 시에만 `detail`이 콘솔/요약에 노출된다.
