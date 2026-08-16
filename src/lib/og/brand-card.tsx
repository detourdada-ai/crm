import { ImageResponse } from "next/og";

/**
 * OG/Twitter 공유 카드 — opengraph-image.tsx와 twitter-image.tsx가 이 함수를
 * 공유해서, "이미지 하나만 봐도 무엇인지 이해되는" 브랜드 카드를 한 곳에서만
 * 관리한다. 실제 서비스 화면 스크린샷이 아니라 브랜드 마크 + 워드마크 +
 * 태그라인 + 업무 흐름 4단어로 구성 — 존재하지 않는 기능이나 허위 숫자는
 * 넣지 않는다(Section 12).
 */

export const OG_ALT = "주문:한장 — 복잡한 주문을 한곳에서";
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const FLOW = ["주문", "배송", "고객", "정산"];
const OG_GLYPHS = "주문:한장복잡, 으로.배송고객정산→" + FLOW.join("");

async function loadKoreanFont(text: string): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@800&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
  if (!match) throw new Error("주문:한장 OG 이미지: Google Fonts CSS에서 폰트 URL을 찾지 못했습니다.");
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

export async function renderBrandCard() {
  const fontData = await loadKoreanFont(OG_GLYPHS);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #ECFDF5 0%, #FFFFFF 65%)",
          fontFamily: "'Noto Sans KR'",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 110,
              height: 128,
              borderRadius: 26,
              background: "#0F172A",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", width: 56, height: 9, borderRadius: 5, background: "#334155" }} />
            <div style={{ display: "flex", width: 40, height: 9, borderRadius: 5, background: "#334155" }} />
            <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
              <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: "#10B981" }} />
              <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: "#FFFFFF" }} />
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: "#0F172A", letterSpacing: -2 }}>
            주문<span style={{ color: "#10B981" }}>:</span>한장
          </div>
        </div>

        <div style={{ display: "flex", marginTop: 28, fontSize: 34, color: "#334155" }}>복잡한 주문, 한 장으로.</div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 48 }}>
          {FLOW.map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  display: "flex",
                  padding: "10px 24px",
                  borderRadius: 999,
                  background: "#059669",
                  color: "#FFFFFF",
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {label}
              </div>
              {i < FLOW.length - 1 ? <div style={{ display: "flex", fontSize: 26, color: "#94A3B8" }}>→</div> : null}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Noto Sans KR", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
