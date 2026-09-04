/**
 * STEP10-8-B(2026-08-28 CPO 작업지시) — 공지 시스템(STEP8-C) 도입 이후, 로그인한
 * role="user" 세션에는 어느 보호 페이지에서든 미확인 공지 팝업이 뜰 수 있다.
 * 공지 시스템을 몰랐던(그 이전에 작성된) 기존 QA 스크립트들은 이 오버레이가
 * 자기 클릭 대상을 가리는 것을 예상하지 못해 타임아웃으로 실패한다
 * (qa:delivery-group-ux-flow의 지역 필터 버튼 클릭 실패 등, STEP10-7-A에서
 * 발견). Production 공지를 끄거나 숨기는 방식으로 QA를 통과시키는 건 CPO
 * 방침에 어긋난다 — 대신 "공지가 있으면 정책대로 치우고, 없으면 그냥
 * 진행"하는 대응을 모든 QA 스크립트가 공유하는 helper 하나로 통일한다.
 *
 * Playwright의 addLocatorHandler()는 정확히 이 용도(쿠키 배너 등 예기치
 * 않은 오버레이가 다음 액션을 막을 때 자동으로 치워주는 것)로 설계된
 * API다 — 매 페이지 이동/클릭 지점마다 수동으로 dismiss 호출을 흩뿌리지
 * 않아도, 그 오버레이가 다른 액션을 막으려는 순간 Playwright가 알아서
 * 먼저 처리해준다.
 *
 * 대상 다이얼로그를 "오늘 그만 보기" 버튼을 담고 있는 role=dialog로 좁혀서
 * 찾는다 — 이 앱의 다른 모든 다이얼로그(삭제 확인/주문 수정 등)는 이 버튼이
 * 없으므로, 그 어떤 시나리오가 스스로 열어둔 다이얼로그도 오탐으로 건드리지
 * 않는다. ESC로 닫는다 — "그냥 닫기"는 dismiss를 기록하지 않으므로(앱 정책,
 * announcement-login-popup.tsx) 이 handler가 실행돼도 실제 공지 dismiss
 * 상태에 어떤 부작용도 남기지 않는다(announcements-flow.ts 자신의 F1-K4
 * 시나리오처럼 dismiss 자체를 검증하는 스크립트에는 이 handler를 등록하지
 * 않는다 — 등록하면 그 스크립트 자신의 클릭을 가로채 버린다).
 *
 * 모든 Playwright 기반 QA 스크립트는 `context.newPage()` 직후
 * `await registerAnnouncementPopupHandler(page)`를 한 번만 호출하면 된다 —
 * 이후 페이지 전체 수명 동안 자동으로 적용되고, 앞으로 공지 시스템에 새
 * 종류의 팝업이 추가돼도(같은 role=dialog 구조를 따르는 한) 각 스크립트를
 * 개별 수정할 필요가 없다.
 */
import type { Page } from "playwright";

export async function registerAnnouncementPopupHandler(page: Page): Promise<void> {
  const announcementDialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "오늘 그만 보기" }) });
  await page.addLocatorHandler(announcementDialog, async () => {
    await page.keyboard.press("Escape");
  });
}

/**
 * addLocatorHandler()는 "다음 액션을 막을 때"만 자동 개입한다 — .click() 같은
 * 실제 조작 앞에서는 알아서 팝업을 치워주지만, .isVisible()/.count()처럼
 * 상태만 읽는 순수 조회는 "액션"이 아니라서 handler가 트리거되지 않는다.
 * Radix Dialog는 열려 있는 동안 나머지 페이지 콘텐츠에 aria-hidden을 걸어서
 * 접근성 트리에서 숨기므로, 공지 팝업이 뜬 채로 페이지 내 다른 버튼을
 * getByRole("button")로 조회하면 실제로는 있는 버튼도 "없음"으로 보인다
 * (앱 버그 아님 — STEP10 E2E 작업 중 발견, Scenario A의 "수정"/"전체 삭제"
 * 버튼 오탐 원인). page.goto() 직후 클릭이 아니라 상태 조회부터 하는
 * 스크립트는 이 함수를 먼저 호출해 명시적으로 치워야 한다.
 */
export async function dismissAnnouncementPopupIfPresent(page: Page): Promise<void> {
  const announcementDialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "오늘 그만 보기" }) });
  if (await announcementDialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await announcementDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

/**
 * STEP12 FINAL GATE(P1-A): 배송건 행이 화면에 나타날 때까지 준비시킨다.
 *
 * 두 가지가 겹쳐서 여러 노후 QA가 "행을 못 찾음"으로 타임아웃났다.
 *  1) STEP12-8F(R12) 이후 배송그룹 카드는 기본 접힘이라 그룹 소속 행은
 *     "상세보기"를 눌러 펼치기 전에는 아예 렌더되지 않는다.
 *  2) 공지 팝업이 modal dialog로 열려 있으면 배경이 접근성 트리에서 제외돼
 *     `getByRole("button", { name: "상세보기" })`가 0개로 잡힌다
 *     (실측: dialog=1, 상세보기버튼=0, 본문에는 버튼 텍스트가 보이는 상태).
 *
 * 그래서 팝업을 먼저 닫고, 버튼은 role이 아닌 CSS 기준으로 찾아 펼친다.
 */
export async function ensureShipmentRowVisible(page: Page, rowKey: string, timeoutMs = 30000): Promise<boolean> {
  const row = page.locator(`[data-testid="shipment-row-${rowKey}"]`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await row.first().isVisible().catch(() => false)) return true;
    await dismissAnnouncementPopupIfPresent(page);
    const detailButtons = page.locator("button", { hasText: "상세보기" });
    const n = await detailButtons.count();
    for (let i = 0; i < n; i++) {
      await detailButtons.nth(i).click({ timeout: 3000 }).catch(() => {});
    }
    if (await row.first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  console.log(`  [ensureShipmentRowVisible 실패] rowKey=${rowKey} — 그룹 펼침/팝업 처리 후에도 행이 보이지 않음`);
  return false;
}
