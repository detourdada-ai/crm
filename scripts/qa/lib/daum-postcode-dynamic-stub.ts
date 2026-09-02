/**
 * daum-postcode-stub.js(고정 주소 1개)의 파라미터화 버전 — 시나리오별로 다른
 * 주소가 필요할 때(예: 배송그룹 지역A/B/C 클러스터, 주소 수정 전/후 비교) 쓴다.
 *
 * 주의: 이 함수 안에서 Postcode 생성자를 인라인 함수로 작성해 그대로
 * context.addInitScript(fn)에 넘기면 안 된다 — tsx/esbuild가 이 .ts 파일을
 * 컴파일하면서 함수에 __name() 헬퍼 참조를 주입하는데, Playwright가 그
 * 함수를 문자열화해 브라우저에 주입하면 __name이 정의되어 있지 않아
 * ReferenceError가 난다(daum-postcode-stub.js 도입 당시 실제로 겪은 문제).
 * 그래서 함수를 넘기지 않고, 이미 완성된 JS 소스 "문자열"을 직접 만들어
 * addInitScript({ content })로 넘긴다 — Playwright가 함수를 toString()할
 * 필요가 없으므로 이 문제를 원천적으로 피한다.
 */
import type { BrowserContext } from "playwright";

export interface DaumAddress {
  roadAddress: string;
  jibunAddress: string;
  zonecode: string;
}

export async function stubDaumPostcodeAddress(context: BrowserContext, address: DaumAddress): Promise<void> {
  const content = `window.daum = { Postcode: function (opts) { this.open = function () { opts.oncomplete(${JSON.stringify(
    address
  )}); }; } };`;
  await context.addInitScript({ content });
}
