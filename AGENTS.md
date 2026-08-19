<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Production DB 안전 규칙 (2026-08-19, 좌표 데이터 손실 사고 후 CPO 지시로 추가)

`.env.local`의 Supabase 프로젝트는 **Production과 동일한 DB**다(별도 스테이징 없음). 배송그룹 라벨 버그를 재현하던 중, 실제 주문 6건(`user1` 테넌트, 진짜 주소/전화번호가 있는 정상 주문)의 좌표를 스크래치 스크립트로 덮어썼고 원복 전 백업을 디스크에 남기지 않아 좌표 데이터가 되돌릴 수 없게 유실됐다. 재발 방지를 위해 아래를 반드시 지킨다.

**절대 금지**
- "가장 주문이 많은 계정" 같은 휴리스틱으로 아무 tenant나 골라 스크래치 스크립트의 대상으로 삼는 것. 실제 서비스 이용 중인 계정(현재 `user1`)의 실데이터는 재현 테스트 대상이 될 수 없다.
- 변경 전 상태를 파일로 저장하지 않고 실운영 row를 직접 UPDATE하는 것.
- 스크립트가 `console.log`로만 백업값을 출력하고 끝내는 것 — 프로세스가 종료되면 그 값은 사라진다. 반드시 디스크에 남겨야 한다.

**Production DB를 건드리는 모든 재현/검증 스크립트는 다음 4단계를 거친다:**
1. **백업/스냅샷** — 건드릴 row 전체를 JSON으로 스크래치 디렉터리에 저장(`scratch_snapshot_<타임스탬프>.json` 등). 콘솔 출력만으로 대체하지 않는다.
2. **변경** — 최소 범위로만, 대상이 테스트 tenant(현재 관례: `user2`/`user3`, 필요시 신규 테스트 tenant 생성)인지 명시적으로 확인 후 실행.
3. **검증** — 목적한 동작을 확인.
4. **자동 원복** — 스크립트의 `finally` 블록에서 반드시 원복까지 실행하고 종료한다. "일단 남겨두고 나중에 정리"는 금지 — `KEEP_TEST_DATA` 같은 플래그로 원복을 건너뛰는 패턴 자체를 쓰지 않는다. 부득이하게 즉시 원복이 안 되는 조사가 필요하면, 그 상태로 세션을 끝내지 말고 같은 턴 안에서 반드시 복구까지 마친다.

재사용 가능한 헬퍼가 `scripts/safe-scratch.ts`에 있다 — 새 재현 스크립트를 짤 때는 이 헬퍼의 `withSnapshot()`을 감싸서 쓴다(직접 `getSupabaseAdmin()`으로 unguarded update를 짜지 않는다).

실제 운영 데이터 조회(읽기전용)는 이 규칙의 대상이 아니다 — 오직 **쓰기(INSERT/UPDATE/DELETE)** 가 필요한 재현/검증에만 적용된다.
