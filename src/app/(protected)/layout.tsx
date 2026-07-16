import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

// Every page here reads live Supabase data (orders/customers/dashboard counts
// change constantly), so none of it should be statically prerendered.
export const dynamic = "force-dynamic";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
