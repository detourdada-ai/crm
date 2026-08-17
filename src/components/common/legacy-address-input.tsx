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
 * F6~F10: 배송지 주소가 아닌 부가 정보(기사 자택 주소, 주문 없이 고객만
 * 빠르게 등록하는 "+ 고객 등록" 다이얼로그)에 쓰는 단순 자유 입력 — 표준
 * 주소(postal_code/road_address/detail_address 분리)가 필요한 배송지 입력은
 * AddressSearchInput을 쓴다.
 */
export function LegacyAddressInput({
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

  useEffect(() => {
    loadDaumPostcodeScript().catch(() => {});
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
