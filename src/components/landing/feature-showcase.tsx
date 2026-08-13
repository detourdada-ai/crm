import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProductPreview, PreviewStat, PreviewRow, PreviewFlowRow } from "./product-preview";

/** 주문 목록에서 하나를 선택하면 상세 팝업이 뜬다는 것 — Ordify의 대표적인 주문 처리 동작. */
function OrdersPreview() {
  return (
    <ProductPreview title="Ordify 주문관리">
      <div className="relative">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">전체</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">신규</span>
          <span className="rounded-full bg-muted px-3 py-1.5 font-medium text-muted-foreground">처리중</span>
        </div>
        <div className="mt-4">
          <PreviewRow primary="김민수 · 상품 A" secondary="신규 주문" badge="신규" badgeTone="primary" />
          <PreviewRow primary="박지현 · 상품 B" secondary="배송 준비 중" badge="처리중" />
          <PreviewRow primary="이수진 · 상품 C" secondary="배송 준비 완료" badge="배송준비" badgeTone="success" />
        </div>

        <div
          className="animate-in fade-in-0 slide-in-from-bottom-2 absolute right-0 bottom-0 w-48 rounded-xl border border-border bg-surface p-3 text-left shadow-lg duration-500 sm:right-2 sm:bottom-2"
        >
          <p className="text-xs font-semibold text-text-strong">주문 상세</p>
          <p className="mt-2 text-xs text-muted-foreground">상품 A</p>
          <p className="text-xs text-muted-foreground">서울시 강남구 ...</p>
          <Button size="sm" className="mt-2 h-7 w-full text-xs">
            배송 준비
          </Button>
        </div>
      </div>
    </ProductPreview>
  );
}

/** 주문을 기사에게 배정하는 동작이 Ordify 배송관리의 핵심 — 배정 UI를 직접 보여준다. */
function DeliveryPreview() {
  return (
    <ProductPreview title="Ordify 배송관리">
      <div className="grid grid-cols-3 gap-2 text-center">
        <PreviewStat label="배송 대기" value="8" />
        <PreviewStat label="배송중" value="5" />
        <PreviewStat label="완료" value="21" />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-medium text-muted-foreground">김민수 주문</p>
        <p className="mt-1 text-sm text-text-strong">배송기사: 홍길동</p>
        <Button size="sm" variant="outline" className="mt-3 h-8 w-full">
          배송 배정
        </Button>
      </div>
    </ProductPreview>
  );
}

/** 고객이 단순 주소록이 아니라 "주문 이력과 연결된 사람"이라는 것을 보여준다. */
function CustomersPreview() {
  return (
    <ProductPreview title="Ordify 고객관리">
      <p className="text-sm font-semibold text-text-strong">김민수</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PreviewStat label="최근 주문" value="8회" />
        <PreviewStat label="누적 구매" value="324,000원" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">최근 주문 · 2026.08.12</p>
      <Button size="sm" variant="outline" className="mt-3 h-8 w-full">
        주문 이력 보기
      </Button>
    </ProductPreview>
  );
}

/** 배송완료 → 정산대상 → 정산완료로 이어지는 흐름 자체를 보여준다. */
function SettlementPreview() {
  return (
    <ProductPreview title="Ordify 정산관리">
      <div className="grid grid-cols-2 gap-3">
        <PreviewStat label="정산 대기" value="₩1,240,000" />
        <PreviewStat label="정산 완료" value="₩3,820,000" />
      </div>
      <div className="mt-4">
        <PreviewFlowRow
          primary="김기사 · 배송 42건"
          secondary="이번 달 정산"
          steps={["배송완료", "정산대상", "정산완료"]}
          activeIndex={2}
        />
        <PreviewFlowRow
          primary="이기사 · 배송 31건"
          secondary="이번 달 정산"
          steps={["배송완료", "정산대상", "정산완료"]}
          activeIndex={1}
        />
      </div>
    </ProductPreview>
  );
}

const FEATURES = [
  {
    eyebrow: "주문 관리",
    headline: "주문을 선택하면 바로 처리할 수 있어요.",
    description: "들어온 주문을 확인하고, 상세 내용을 보고 바로 다음 단계로 넘깁니다.",
    preview: OrdersPreview,
  },
  {
    eyebrow: "배송 관리",
    headline: "배송할 주문을 기사에게 바로 배정하세요.",
    description: "배송일별로 정리된 주문을 확인하고, 담당 기사를 몇 번의 클릭으로 배정합니다.",
    preview: DeliveryPreview,
  },
  {
    eyebrow: "고객 관리",
    headline: "고객마다 쌓인 주문 이력을 바로 확인합니다.",
    description: "동일 고객을 자동으로 연결하고, 얼마나 자주·많이 구매했는지 한눈에 보여줍니다.",
    preview: CustomersPreview,
  },
  {
    eyebrow: "기사 정산",
    headline: "배송 완료부터 정산 완료까지 이어집니다.",
    description: "배송 완료 건수를 기준으로 기사별 정산 금액이 자동으로 집계됩니다.",
    preview: SettlementPreview,
  },
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
