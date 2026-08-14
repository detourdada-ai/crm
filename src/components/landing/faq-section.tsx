const FAQS = [
  {
    q: "스마트스토어를 쓰는데 필요한가요?",
    a: "스마트스토어를 대체하지 않습니다. 주문 이후의 업무를 관리하기 위한 서비스입니다.",
  },
  {
    q: "택배만 보내는데 필요한가요?",
    a: "현재는 필요성이 낮을 수 있습니다.",
  },
  {
    q: "자체배송을 하고 있는데요?",
    a: "주문:한장의 핵심 검증 대상입니다.",
  },
  {
    q: "전화 주문도 관리할 수 있나요?",
    a: "표준 주문 접수 방식으로 관리할 수 있도록 확장합니다.",
  },
  {
    q: "기사에게 매번 카톡으로 보내야 하나요?",
    a: "주문별 담당자를 지정하고 업무 상태를 관리하는 것이 핵심입니다.",
  },
  {
    q: "어떤 업종에서 사용할 수 있나요?",
    a: "반찬, 도시락, 꽃·화환, 케이크, 식품 등 주문 이후 별도 업무가 발생하는 사업자를 우선 검증합니다.",
  },
];

export function FaqSection() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <h2 className="text-center text-2xl font-bold text-text-strong sm:text-3xl">자주 묻는 질문</h2>
      <div className="mt-10 space-y-3">
        {FAQS.map((faq) => (
          <details key={faq.q} className="group rounded-xl border border-border bg-surface px-5 py-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-text-strong marker:content-none">
              Q. {faq.q}
            </summary>
            <p className="mt-2.5 text-sm text-muted-foreground">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
