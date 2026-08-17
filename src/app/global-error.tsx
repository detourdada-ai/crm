"use client";

import { useEffect } from "react";

/**
 * F15: 루트 레이아웃 자체가 렌더링에 실패하는 최악의 경우를 위한 최후의
 * error boundary — (protected)/error.tsx는 그 하위 라우트만 잡고, 랜딩/로그인/
 * subscription 등 route group 밖 페이지는 지금까지 아무 boundary도 없었다.
 * global-error는 자체 html/body를 렌더링해야 한다(Next.js 컨벤션).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", fontFamily: "sans-serif" }}>
          <p style={{ fontWeight: 600, fontSize: 16 }}>문제가 발생했습니다.</p>
          <p style={{ maxWidth: 400, fontSize: 14, color: "#666" }}>
            일시적인 오류일 수 있습니다. 다시 시도해도 계속되면 잠시 후 다시 이용해주세요.
          </p>
          <button
            onClick={reset}
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
