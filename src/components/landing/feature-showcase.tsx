import { cn } from "@/lib/utils";
import { ProductPreview, PreviewStat, PreviewRow } from "./product-preview";

function OrdersPreview() {
  return (
    <ProductPreview path="/orders">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체 128</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">배송대기 32</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">배송중 41</span>
        <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">완료 55</span>
      </div>
      <div className="mt-5">
        <PreviewRow primary="김민수 · 010-****-1234" secondary="ORD-1023 · 오늘 배송" badge="배송대기" />
        <PreviewRow primary="이지은 · 010-****-5678" secondary="ORD-1022 · 오늘 배송" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="박철수 · 010-****-9012" secondary="ORD-1021 · 내일 배송" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function DeliveryPreview() {
  return (
    <ProductPreview path="/delivery">
      <p className="text-xs font-medium text-muted-foreground">8월 13일 배송 · 기사 배정</p>
      <div className="mt-3">
        <PreviewRow primary="김기사" secondary="담당 12건" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="이기사" secondary="담당 9건" badge="배송대기" />
        <PreviewRow primary="박기사" secondary="담당 15건" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function CustomersPreview() {
  return (
    <ProductPreview path="/customers">
      <div>
        <PreviewRow primary="김민수" secondary="주문 14회 · 최근 8/10" badge="VIP" badgeTone="primary" />
        <PreviewRow primary="이영희" secondary="주문 6회 · 최근 8/9" badge="재구매" />
        <PreviewRow primary="박철수" secondary="주문 2회 · 최근 7/28" badge="일반" />
      </div>
    </ProductPreview>
  );
}

function SettlementPreview() {
  return (
    <ProductPreview path="/settlements">
      <div className="grid grid-cols-3 gap-3">
        <PreviewStat label="정산 대기" value="12건" />
        <PreviewStat label="이번 달 정산액" value="₩1,240,000" />
        <PreviewStat label="완료" value="38건" />
      </div>
    </ProductPreview>
  );
}

const FEATURES = [
  { eyebrow: "주문 관리", headline: "주문이 들어오면 바로 정리됩니다.", preview: OrdersPreview },
  { eyebrow: "배송 관리", headline: "배송도 한눈에 관리하세요.", preview: DeliveryPreview },
  { eyebrow: "기사 정산", headline: "정산까지 하나의 흐름으로.", preview: SettlementPreview },
  { eyebrow: "고객 관리", headline: "고객을 다시 찾는 시간도 줄어듭니다.", preview: CustomersPreview },
];

export function FeatureShowcase() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="space-y-20">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.headline}
            className={cn("grid items-center gap-10 lg:grid-cols-2 lg:gap-16", i % 2 === 1 && "lg:[&>*:first-child]:order-2")}
          >
            <div className={cn(i % 2 === 0 ? "lg:text-left" : "lg:text-right")}>
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">{feature.eyebrow}</span>
              <h3 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">{feature.headline}</h3>
            </div>
            <feature.preview />
          </div>
        ))}
      </div>
    </section>
  );
}
