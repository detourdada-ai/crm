import { Check } from "lucide-react";

const CRITERIA = [
  "온라인 주문이 들어오는 사업자",
  "하루 주문이 어느 정도 발생하는 사업자",
  "자체배송을 운영하는 사업자",
  "직원/기사에게 주문을 배정하는 사업자",
  "엑셀로 배송목록을 관리하는 사업자",
  "카카오톡/문자로 직원·기사에게 업무를 전달하는 사업자",
  "배송상태를 직접 확인하는 사업자",
  "고객에게 배송 관련 문의를 자주 받는 사업자",
];

const EXAMPLES = ["반찬", "도시락", "꽃·화환", "케이크", "식품", "자체배송 사업자"];

export function TargetAudience() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">모집 대상</span>
        <h2 className="mt-2 text-2xl font-bold text-text-strong sm:text-3xl">이런 사장님을 찾고 있습니다.</h2>
      </div>

      <ul className="mx-auto mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
        {CRITERIA.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-text-strong">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((example) => (
          <span key={example} className="rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary">
            {example}
          </span>
        ))}
      </div>
    </section>
  );
}
