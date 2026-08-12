import { ShoppingCart, Truck, Wallet, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signInWithGoogleAction } from "@/actions/google-auth";
import { SiteFooter } from "@/components/landing/site-footer";

const FEATURES = [
  { icon: ShoppingCart, title: "주문관리", description: "엑셀 업로드부터 수동 등록까지, 주문을 한눈에 관리합니다." },
  { icon: Truck, title: "배송관리", description: "배송일 기준으로 주문을 분류하고 기사에게 배정합니다." },
  { icon: Wallet, title: "기사 정산", description: "배송 완료 건수를 기준으로 기사 정산을 자동 집계합니다." },
  { icon: Users, title: "고객관리", description: "동일 고객을 자동으로 찾아내고 구매 이력을 통합 관리합니다." },
];

// Sprint 14-D: public Landing at "/" — Dashboard moved to /dashboard.
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Ordify</h1>
          <p className="mt-4 text-xl font-medium text-foreground">
            주문부터 배송·정산까지
            <br />
            한 곳에서 간편하게.
          </p>
          <p className="mt-3 text-muted-foreground">
            엑셀 주문을 올리고 주문·배송·기사 정산을 쉽게 관리하세요.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <form action={signInWithGoogleAction}>
              <Button type="submit" size="lg" className="gap-2">
                Google로 무료 시작하기
              </Button>
            </form>
            <Badge variant="outline">현재 Beta 서비스로 무료로 이용하실 수 있습니다</Badge>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <feature.icon className="size-6 text-primary" />
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
