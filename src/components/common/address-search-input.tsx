"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DaumPostcodeData {
  roadAddress: string;
  jibunAddress: string;
  zonecode: string;
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: { oncomplete: (data: DaumPostcodeData) => void }) => { open: () => void };
    };
  }
}

const DAUM_POSTCODE_SCRIPT_ID = "daum-postcode-script";
const DAUM_POSTCODE_SRC = "//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

function loadDaumPostcodeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.daum?.Postcode) {
      resolve();
      return;
    }
    const existing = document.getElementById(DAUM_POSTCODE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("주소 검색 스크립트를 불러오지 못했습니다.")));
      return;
    }
    const script = document.createElement("script");
    script.id = DAUM_POSTCODE_SCRIPT_ID;
    script.src = DAUM_POSTCODE_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("주소 검색 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

/**
 * 다음(카카오) 우편번호 서비스로 표준 주소를 검색해 채워 넣는 주소 입력.
 * 검색 결과는 도로명 주소까지만 채우고, 동/호수 등 상세 주소는 이어서 직접
 * 입력하도록 둔다 (별도 필드로 분리하지 않음 — 기존 address 컬럼이 단일
 * 문자열이라 스키마 변경 없이 적용 가능).
 */
export function AddressSearchInput({
  id,
  name,
  defaultValue,
  required,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  // 클릭 시점에 스크립트 로딩을 기다리면(await) 브라우저가 그 사이 사용자
  // 제스처(user activation)를 소진해 팝업이 차단될 수 있으므로, 마운트 시
  // 미리 로드해 두어 클릭 핸들러가 항상 동기적으로 .open()을 호출하게 한다.
  useEffect(() => {
    loadDaumPostcodeScript().catch(() => {
      // 로드 실패해도 직접 입력은 계속 가능
    });
  }, []);

  function openSearch() {
    const applyResult = (data: DaumPostcodeData) => {
      const base = data.roadAddress || data.jibunAddress;
      setValue((prev) => {
        const detail = prev.trim();
        return detail && detail !== base ? `${base} ` : base;
      });
    };

    if (window.daum?.Postcode) {
      new window.daum.Postcode({ oncomplete: applyResult }).open();
      return;
    }
    loadDaumPostcodeScript()
      .then(() => new window.daum!.Postcode({ oncomplete: applyResult }).open())
      .catch(() => {});
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        placeholder="주소 검색을 이용하거나 직접 입력하세요"
      />
      <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={openSearch}>
        <Search className="size-4" />
        주소 검색
      </Button>
    </div>
  );
}
