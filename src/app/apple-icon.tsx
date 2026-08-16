import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS 홈 화면 아이콘 — 브랜드 마크만 크게, 텍스트 없음(폰트 로딩 불필요). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ECFDF5",
        }}
      >
        <div
          style={{
            width: 130,
            height: 150,
            borderRadius: 30,
            background: "#0F172A",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", width: 66, height: 11, borderRadius: 6, background: "#334155" }} />
          <div style={{ display: "flex", width: 48, height: 11, borderRadius: 6, background: "#334155" }} />
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            <div style={{ display: "flex", width: 22, height: 22, borderRadius: 11, background: "#10B981" }} />
            <div style={{ display: "flex", width: 22, height: 22, borderRadius: 11, background: "#FFFFFF" }} />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
