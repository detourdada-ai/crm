import { cn } from "@/lib/utils";
import { ProductPreview, PreviewStat, PreviewRow } from "./product-preview";

function OrdersPreview() {
  return (
    <ProductPreview title="Ordify — 주문관리">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground">전체 128</span>
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">배송대기 32</span>
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">배송중 41</span>
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">완료 51</span>
      </div>
      <div className="mt-4">
        <PreviewRow primary="김민수 · 010-****-1234" secondary="8/13 배송" badge="배송대기" />
        <PreviewRow primary="이영희 · 010-****-5678" secondary="8/13 배송" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="박철수 · 010-****-9012" secondary="8/14 배송" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function DeliveryPreview() {
  return (
    <ProductPreview title="Ordify — 배송관리">
      <p className="text-xs font-medium text-muted-foreground">8월 13일 배송 · 기사 배정</p>
      <div className="mt-2">
        <PreviewRow primary="김기사" secondary="담당 12건" badge="배송중" badgeTone="primary" />
        <PreviewRow primary="이기사" secondary="담당 9건" badge="배송대기" />
        <PreviewRow primary="박기사" secondary="담당 15건" badge="완료" badgeTone="success" />
      </div>
    </ProductPreview>
  );
}

function CustomersPreview() {
  return (
    <ProductPreview title="Ordify — 고객관리">
      <div className="mt-1">
        <PreviewRow primary="김민수" secondary="주문 14회 · 최근 8/10" badge="VIP" badgeTone="primary" />
        <PreviewRow primary="이영희" secondary="주문 6회 · 최근 8/9" badge="재구매" />
        <PreviewRow primary="박철수" secondary="주문 2회 · 최근 7/28" badge="일반" />
      </div>
    </ProductPreview>
  );
}

function SettlementPreview() {
  return (
    <ProductPreview title="Ordify — 정산관리">
      <div className="grid grid-cols-3 gap-2">
        <PreviewStat label="정산 대기" value="12건" />
        <PreviewStat label="이번 달 정산액" value="₩1,240,000" />
        <PreviewStat label="완료" value="38건" />
      </div>
    </ProductPreview>
  );
}

const FEATURES = [
  {
    eyebrow: "01",
    title: "주문 관리",
    headline: "엑셀 주문도 한 번에 등록",
    description: "스마트스토어 등에서 받은 주문 파일을 업로드하고 주문을 한곳에서 관리하세요.",
    preview: OrdersPreview,
  },
  {
    eyebrow: "02",
    title: "배송 관리",
    headline: "배송일과 기사 배정을 한눈에",
    description: "배송일별 주문을 확인하고 기사에게 빠르게 배정하세요.",
    preview: DeliveryPreview,
  },
  {
    eyebrow: "03",
    title: "고객 관리",
    headline: "반복 주문 고객을 놓치지 않게",
    description: "주문 이력과 고객 정보를 한곳에서 관리하고 동일 고객을 자동으로 연결합니다.",
    preview: CustomersPreview,
  },
  {
    eyebrow: "04",
    title: "기사 정산",
    headline: "배송이 끝나면 정산까지",
    description: "배송 완료 건수를 기준으로 기사별 정산을 간편하게 확인하세요.",
    preview: SettlementPreview,
  },
];

export function FeatureShowcase() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-2xl font-bold text-text-strong sm:text-3xl">매일의 주문 업무, 화면 하나로</h2>
        <p className="mt-3 text-muted-foreground">기능 목록이 아니라, 실제로 매일 처리하는 업무 순서 그대로입니다.</p>
      </div>

      <div className="mt-14 space-y-16">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.title}
            className={cn(
              "grid items-center gap-10 lg:grid-cols-2 lg:gap-16",
              i % 2 === 1 && "lg:[&>*:first-child]:order-2"
            )}
          >
            <div>
              <span className="text-xs font-semibold tracking-wide text-primary">{feature.eyebrow}</span>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{feature.title}</p>
              <h3 className="mt-2 text-xl font-bold text-text-strong sm:text-2xl">{feature.headline}</h3>
              <p className="mt-3 text-muted-foreground">{feature.description}</p>
            </div>
            <feature.preview />
          </div>
        ))}
      </div>
    </section>
  );
}
