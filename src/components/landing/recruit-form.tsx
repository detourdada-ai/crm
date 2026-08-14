"use client";

import { useActionState } from "react";
import { submitBetaRecruitApplicationAction, type RecruitApplicationActionState } from "@/actions/beta-recruit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const initialState: RecruitApplicationActionState = { ok: false, error: null };

const BUSINESS_TYPES = ["반찬", "도시락", "꽃·화환", "케이크·답례품", "식품", "기타"];
const ORDER_CHANNELS = ["스마트스토어", "전화", "문자", "카카오", "기타"];
const DELIVERY_METHODS = ["자체배송", "택배", "퀵", "직접 픽업", "혼합"];

export function RecruitForm() {
  const [state, formAction, isPending] = useActionState(submitBetaRecruitApplicationAction, initialState);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="font-semibold text-text-strong">신청이 접수되었습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          말씀해주신 내용을 확인 후, 담당자가 직접 연락드리겠습니다.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className="space-y-4">
        <p className="text-sm font-semibold text-text-strong">사업 정보</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="companyName">업체명</Label>
            <Input id="companyName" name="companyName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="businessType">업종</Label>
            <select
              id="businessType"
              name="businessType"
              required
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                선택해주세요
              </option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="avgDailyOrders">하루 평균 주문량</Label>
            <Input id="avgDailyOrders" name="avgDailyOrders" placeholder="예: 30~50건" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deliveryMethod">배송 방식</Label>
            <select
              id="deliveryMethod"
              name="deliveryMethod"
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">선택 안 함</option>
              {DELIVERY_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>주문 채널 (복수 선택 가능)</Label>
          <div className="flex flex-wrap gap-4">
            {ORDER_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm text-text-strong">
                <Checkbox name="orderChannels" value={channel} />
                {channel}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-6">
        <p className="text-sm font-semibold text-text-strong">운영 정보</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="staffCount">직원 수</Label>
            <Input id="staffCount" name="staffCount" placeholder="예: 2명" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="driverCount">기사/담당자 수</Label>
            <Input id="driverCount" name="driverCount" placeholder="예: 1명" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="currentOrderManagement">현재 주문 관리 방식</Label>
            <Input id="currentOrderManagement" name="currentOrderManagement" placeholder="예: 스마트스토어 화면에서 직접 확인" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="currentDeliveryManagement">현재 배송/업무 관리 방식</Label>
            <Input id="currentDeliveryManagement" name="currentDeliveryManagement" placeholder="예: 엑셀로 기사별 목록 작성" />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-text-strong">
            <Checkbox name="usesExcel" />
            엑셀을 사용합니다
          </label>
          <label className="flex items-center gap-2 text-sm text-text-strong">
            <Checkbox name="usesKakaoSms" />
            카카오톡/문자를 사용합니다
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-6">
        <Label htmlFor="biggestPainPoint">현재 주문이 들어온 후 가장 불편한 일은 무엇인가요?</Label>
        <Textarea id="biggestPainPoint" name="biggestPainPoint" required rows={4} maxLength={2000} />
      </div>

      <div className="space-y-4 border-t border-border pt-6">
        <p className="text-sm font-semibold text-text-strong">연락처</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contactName">담당자명</Label>
            <Input id="contactName" name="contactName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactPhone">전화번호</Label>
            <Input id="contactPhone" name="contactPhone" required placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="contactEmail">이메일 (선택)</Label>
            <Input id="contactEmail" name="contactEmail" type="email" />
          </div>
        </div>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "제출 중..." : "우리 사업 이야기 들려주기"}
      </Button>
    </form>
  );
}
