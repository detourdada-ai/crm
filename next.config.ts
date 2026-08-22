import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated package-lock.json in a parent directory otherwise confuses
  // Turbopack's workspace-root inference.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // confirmImportAction(fileName, parsed, mapping)으로 파싱된 엑셀 시트 전체
  // (원본 각 컬럼을 그대로 보존하는 order_items.extra 포함, 340행 x 20~30열
  // 한글 데이터)가 서버 액션 인자로 그대로 직렬화되는데, Next.js 기본 서버
  // 액션 바디 제한(1MB)을 실제 스마트스토어 내보내기 파일이 쉽게 초과해
  // "340건 등록 에러"의 실제 원인이었다 — 앱 내부 로직(rollback/에러기록)에
  // 도달하기도 전에 Next.js가 요청 자체를 거부했다.
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
