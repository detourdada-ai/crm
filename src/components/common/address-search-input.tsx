"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
 * F7 주소 표준화: 도로명주소/우편번호는 다음(카카오) 우편번호 검색 결과로만
 * 채워지고 직접 입력할 수 없다("주소 검색을 거치지 않은 임의 주소 입력은
 * 허용하지 않는다") — 상세주소(동/호수 등)만 자유 입력이다. name prop을
 * 접두사로 삼아 postalCode/roadAddress/detailAddress 3개의 폼 필드를 각각
 * `${name}PostalCode` 등으로 제출한다.
 */
export function AddressSearchInput({
  name,
  defaultPostalCode,
  defaultRoadAddress,
  defaultDetailAddress,
  required,
}: {
  name: string;
  defaultPostalCode?: string | null;
  defaultRoadAddress?: string | null;
  defaultDetailAddress?: string | null;
  required?: boolean;
}) {
  const [postalCode, setPostalCode] = useState(defaultPostalCode ?? "");
  const [roadAddress, setRoadAddress] = useState(defaultRoadAddress ?? "");
  const [detailAddress, setDetailAddress] = useState(defaultDetailAddress ?? "");

  // 클릭 시점에 스크립트 로딩을 기다리면(await) 브라우저가 그 사이 사용자
  // 제스처(user activation)를 소진해 팝업이 차단될 수 있으므로, 마운트 시
  // 미리 로드해 두어 클릭 핸들러가 항상 동기적으로 .open()을 호출하게 한다.
  useEffect(() => {
    loadDaumPostcodeScript().catch(() => {
      // 로드 실패해도 상세주소 입력은 계속 가능
    });
  }, []);

  function openSearch() {
    const applyResult = (data: DaumPostcodeData) => {
      setRoadAddress(data.roadAddress || data.jibunAddress);
      setPostalCode(data.zonecode);
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
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={roadAddress ? `[${postalCode}] ${roadAddress}` : ""}
          readOnly
          placeholder="주소 검색을 눌러 도로명 주소를 선택하세요"
          className="bg-muted"
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={openSearch}>
          <Search className="size-4" />
          주소 검색
        </Button>
      </div>
      <Label htmlFor={`${name}DetailAddress`} className="sr-only">
        상세주소
      </Label>
      <Input
        id={`${name}DetailAddress`}
        name={`${name}DetailAddress`}
        value={detailAddress}
        onChange={(e) => setDetailAddress(e.target.value)}
        placeholder="상세주소 (동/호수 등)"
        required={required}
      />
      <input type="hidden" name={`${name}PostalCode`} value={postalCode} />
      <input type="hidden" name={`${name}RoadAddress`} value={roadAddress} />
    </div>
  );
}
