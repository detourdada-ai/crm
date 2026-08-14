"use client";

import { useActionState, useState } from "react";
import { ChevronDown } from "lucide-react";
import { submitBetaRecruitApplicationAction, type RecruitApplicationActionState } from "@/actions/beta-recruit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const initialState: RecruitApplicationActionState = { ok: false, error: null };

const BUSINESS_TYPES = ["반찬", "도시락", "꽃·화환", "케이크·답례품", "식품", "기타"];
const ORDER_CHANNELS = ["스마트스토어", "전화", "문자", "카카오", "기타"];
const DELIVERY_METHODS = ["직접 배송", "직원 배송", "기사님/외부 배송", "택배", "배송하지 않음", "기타"];
const AVG_DAILY_ORDERS = ["하루 10건 이하", "하루 10~30건", "하루 30~100건", "하루 100건 이상", "잘 모르겠음"];
const ORDER_MANAGEMENT_METHODS = ["엑셀", "수기", "스마트스토어", "카카오/전화", "여러 곳을 함께 사용", "기타"];

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * 랜딩 UX 개편: 처음부터 긴 폼을 보여주지 않는다 — 필수는 이름/연락처/업종
 * 3개뿐이고, 나머지는 "조금 더 알려주시면" 영역을 펼쳐야 나타나는 선택
 * 입력이다. 이 사람이 Beta 후보군인지 판단할 최소 정보만 우선 받고,
 * 나머지는 이후 대화로 확인한다는 전략을 그대로 UX에 반영한다.
 */
export function RecruitForm() {
  const [state, formAction, isPending] = useActionState(submitBetaRecruitApplicationAction, initialState);
  const [expanded, setExpanded] = useState(false);

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.15)]">
        <p className="font-semibold text-text-strong">신청이 접수되었습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          말씀해주신 내용을 확인 후, 담당자가 직접 연락드리겠습니다.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.15)] sm:p-8"
    >
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className="space-y-4">
        <p className="text-sm font-semibold text-text-strong">사업 정보를 간단히 알려주세요.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contactName">이름</Label>
            <Input id="contactName" name="contactName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactPhone">연락처</Label>
            <Input id="contactPhone" name="contactPhone" required placeholder="010-0000-0000" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="businessType">업종</Label>
            <select id="businessType" name="businessType" required defaultValue="" className={selectClass}>
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
        </div>
      </div>

      <Collapsible open={expanded} onOpenChange={setExpanded} className="border-t border-border pt-5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>조금 더 알려주시면 더 정확하게 이야기 나눌 수 있어요. (선택)</span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-primary">
              {expanded ? "접기" : "추가 정보 입력하기"}
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-6 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">업체명</Label>
              <Input id="companyName" name="companyName" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">이메일</Label>
              <Input id="contactEmail" name="contactEmail" type="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avgDailyOrders">월 주문량</Label>
              <select id="avgDailyOrders" name="avgDailyOrders" defaultValue="" className={selectClass}>
                <option value="">선택 안 함</option>
                {AVG_DAILY_ORDERS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryMethod">배송 방식</Label>
              <select id="deliveryMethod" name="deliveryMethod" defaultValue="" className={selectClass}>
                <option value="">선택 안 함</option>
                {DELIVERY_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="currentOrderManagement">현재 주문 관리 방식</Label>
              <select id="currentOrderManagement" name="currentOrderManagement" defaultValue="" className={selectClass}>
                <option value="">선택 안 함</option>
                {ORDER_MANAGEMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staffCount">직원 수</Label>
              <Input id="staffCount" name="staffCount" placeholder="예: 2명" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driverCount">기사/담당자 수</Label>
              <Input id="driverCount" name="driverCount" placeholder="예: 1명" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>주문이 들어오는 채널 (복수 선택 가능)</Label>
            <div className="flex flex-wrap gap-4">
              {ORDER_CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-sm text-text-strong">
                  <Checkbox name="orderChannels" value={channel} />
                  {channel}
                </label>
              ))}
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

          <div className="space-y-2">
            <Label htmlFor="biggestPainPoint">가장 불편한 업무가 있다면 알려주세요</Label>
            <Textarea id="biggestPainPoint" name="biggestPainPoint" rows={3} maxLength={2000} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "제출 중..." : "우리 사업 이야기 들려주기"}
      </Button>
    </form>
  );
}
