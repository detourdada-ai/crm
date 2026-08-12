import Link from "next/link";
import { ContactForm } from "@/components/contact/contact-form";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-2">
          ← Ordify로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">문의하기</h1>
        <p className="mt-2 text-sm text-muted-foreground">궁금한 점을 남겨주시면 확인 후 답변드리겠습니다.</p>
      </div>
      <ContactForm />
    </div>
  );
}
