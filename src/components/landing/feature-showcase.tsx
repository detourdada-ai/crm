import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewRow } from "./product-preview";

function MockSearchBar({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
      <Search className="size-4" />
      {placeholder}
    </div>
  );
}

function OrdersPreview() {
  return (
    <ProductPreview path="/orders">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체 128</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">배송대기 32</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">배송중 41</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">완료 55</span>
        </div>
        <Button size="sm" className="hidden shrink-0 sm:inline-flex">
          + 주문 등록
        </Button>
      </div>
      <div className="mt-3">
        <MockSearchBar placeholder="주문번호, 고객명으로 검색" />
      </div>
      <div className="mt-4">
        <PreviewRow primary="김민수 · 반찬 3종 세트" secondary="ORD-1023 · 32,000원 · 오늘 배송" badge="배송대기" />
        <PreviewRow primary="이지은 · 국물요리 세트" secondary="ORD-1022 · 45,000원 · 오늘 배송" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="박철수 · 밑반찬 모음" secondary="ORD-1021 · 28,000원 · 내일 배송" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function DeliveryPreview() {
  return (
    <ProductPreview path="/delivery">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">8월 13일 배송</p>
        <Button size="sm" variant="outline" className="hidden shrink-0 sm:inline-flex">
          기사 배정
        </Button>
      </div>
      <div className="mt-4">
        <PreviewRow primary="김기사" secondary="담당 12건 · 강남·서초" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="이기사" secondary="담당 9건 · 송파·강동" badge="배송대기" />
        <PreviewRow primary="박기사" secondary="담당 15건 · 마포·서대문" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function CustomersPreview() {
  return (
    <ProductPreview path="/customers">
      <MockSearchBar placeholder="이름, 전화번호로 검색" />
      <div className="mt-4">
        <PreviewRow primary="김민수 · 010-****-1234" secondary="주문 14회 · 총 812,000원 · 최근 8/10" badge="VIP" badgeTone="primary" />
        <PreviewRow primary="이영희 · 010-****-5678" secondary="주문 6회 · 총 214,000원 · 최근 8/9" badge="재구매" />
        <PreviewRow primary="박철수 · 010-****-9012" secondary="주문 2회 · 총 56,000원 · 최근 7/28" badge="일반" />
      </div>
    </ProductPreview>
  );
}

function SettlementPreview() {
  return (
    <ProductPreview path="/settlements">
      <div className="grid grid-cols-3 gap-3">
        <PreviewStat label="정산 대기" value="12건" />
        <PreviewStat label="정산 완료" value="38건" />
        <PreviewStat label="이번 달 정산액" value="₩1,240,000" />
      </div>
      <div className="mt-5">
        <PreviewRow primary="김기사" secondary="배송 42건" badge="정산완료" badgeTone="success" />
        <PreviewRow primary="이기사" secondary="배송 31건" badge="정산대기" />
      </div>
    </ProductPreview>
  );
}

const FEATURES = [
  { eyebrow: "주문 관리", headline: "주문이 들어오면 바로 정리됩니다.", description: "엑셀 주문도 한 곳에서 불러오고, 처리해야 할 주문을 빠르게 확인할 수 있습니다.", preview: OrdersPreview },
  { eyebrow: "배송 관리", headline: "배송할 주문을 한눈에 확인하세요.", description: "배송일별로 정리된 주문을 기사에게 빠르게 배정합니다.", preview: DeliveryPreview },
  { eyebrow: "고객 관리", headline: "구매 고객을 자동으로 모아 관리합니다.", description: "동일 고객을 자동으로 연결하고, VIP와 재구매 고객을 바로 알아봅니다.", preview: CustomersPreview },
  { eyebrow: "기사 정산", headline: "배송 완료부터 기사 정산까지 연결됩니다.", description: "배송 완료 건수를 기준으로 기사별 정산 금액을 자동 집계합니다.", preview: SettlementPreview },
];

export function FeatureShowcase() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="space-y-24">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.headline}
            className={cn("grid items-center gap-10 lg:grid-cols-2 lg:gap-16", i % 2 === 1 && "lg:[&>*:first-child]:order-2")}
          >
            <div className={cn(i % 2 === 0 ? "lg:text-left" : "lg:text-right")}>
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">{feature.eyebrow}</span>
              <h3 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">{feature.headline}</h3>
              <p className="mt-3 text-muted-foreground">{feature.description}</p>
            </div>
            <feature.preview />
          </div>
        ))}
      </div>
    </section>
  );
}
