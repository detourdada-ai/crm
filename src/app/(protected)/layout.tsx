import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { requireSession } from "@/lib/auth/current-session";
import { requireActiveAccess } from "@/lib/auth/access-control";

// Every page here reads live Supabase data (orders/customers/dashboard counts
// change constantly), so none of it should be statically prerendered.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // Sprint 11: single choke point for the seller access gate, so direct URL
  // access to any page under this route group is covered, not just menu
  // visibility. See requireActiveAccess's own doc comment for the admin/
  // driver exemptions.
  const session = await requireSession();
  await requireActiveAccess(session);

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
