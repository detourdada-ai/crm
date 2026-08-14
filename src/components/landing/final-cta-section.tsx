import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FinalCtaSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="rounded-2xl bg-[#0f172a] px-6 py-16 text-center sm:px-16">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          오늘 해야 할 주문부터
          <br />더 간단하게.
        </h2>
        <p className="mt-3 text-white/70">
          작은 가게의 주문과 배송 업무를
          <br />
          주문:한장으로 한곳에서 관리하세요.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">무료로 시작하기</Link>
          </Button>
          <p className="text-sm text-white/60">
            이미 계정이 있다면{" "}
            <Link href="/login" className="font-medium text-white underline underline-offset-2">
              로그인
            </Link>
            하세요.
          </p>
        </div>
      </div>
    </section>
  );
}
