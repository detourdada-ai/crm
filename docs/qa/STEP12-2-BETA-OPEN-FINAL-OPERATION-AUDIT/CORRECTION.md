# 정정 (STEP12-3에서 발견, 2026-08-31)

이 Gate(STEP12-2)의 CTO-REPORT.md "⚠️ CPO 필독" 섹션과 Section H가 보고한 **"5건 저장과 150건 저장이 배치 크기와 무관하게 ~30-34초 고정비용을 가진다"**는 결론을 **철회합니다.**

**원인**: 이 Gate에서 사용한 QA 스크립트(`scripts/qa/step12-2-final-operation-audit.ts`)의 `draftCountText()` 헬퍼가 Playwright의 `.textContent()`를 사용했는데, 이 메서드는 매칭 요소가 0개일 때 기본 30초(actionTimeout) 동안 auto-wait로 재시도한 뒤에야 실패로 처리됩니다. 저장 성공 시 "변경사항 N건" 표시가 화면에서 완전히 사라지는 정상 동작이 바로 이 "0개 매치" 상황이었고, 매번 이 30초 타임아웃을 그대로 다 기다린 뒤 측정을 마쳤던 것이 실제 원인이었습니다. 배치 크기와 무관하게 항상 ~30초로 나온 것은 이 타임아웃 자체가 고정값이었기 때문입니다.

**실제 저장 소요시간**: 서버/클라이언트 계측 및 QA 헬퍼 수정(`.count()`로 auto-wait 없이 즉시 확인) 후 재측정한 결과, 5건 저장은 2.3~5.8초, 150건 저장은 3.3~4.5초로 확인되었습니다(로컬 2회 + Production 1회, 12/12 PASS 유지). 배치 크기와 무관한 고정비용이라는 특성 자체가 존재하지 않았습니다.

상세 조사 과정과 근거는 [`../STEP12-3-DELIVERY-SAVE-PERFORMANCE-ROOT-CAUSE/CTO-REPORT.md`](../STEP12-3-DELIVERY-SAVE-PERFORMANCE-ROOT-CAUSE/CTO-REPORT.md) 참조.

이 정정은 STEP12-2의 다른 결론(P0 없음, Section D UX 클린 확인, Section C/G 저장·새로고침 유지 확인 등)에는 영향을 주지 않습니다 — Section H(성능)에만 해당합니다. STEP12-2 자체의 `CTO FINAL: PASS` 판정도 변경되지 않습니다(애초에 이 성능 특성을 이유로 감사를 중단하지 않았으므로).
