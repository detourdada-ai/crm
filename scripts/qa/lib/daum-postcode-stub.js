// Playwright addInitScript용 — 순수 JS 파일로 둬서 tsx/esbuild의 __name() 헬퍼
// 주입을 피한다(esbuild가 컴파일한 .ts 안의 함수는 브라우저로 직렬화될 때
// __name() 참조가 남아 ReferenceError가 난다). Daum 우편번호 팝업은 우리
// 코드가 아닌 외부 위젯이므로, 실제 팝업 대신 고정 주소로 즉시 완료시킨다.
window.daum = {
  Postcode: function (opts) {
    this.open = function () {
      opts.oncomplete({
        roadAddress: "서울 강남구 테헤란로 152",
        jibunAddress: "서울 강남구 역삼동 823",
        zonecode: "06236",
      });
    };
  },
};
