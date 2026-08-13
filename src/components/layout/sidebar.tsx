import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { NavLinks } from "./nav-links";
import { getSession } from "@/lib/auth/current-session";

export async function Sidebar() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <OrdifyLogo variant="full" />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks isDriver={isDriver} isAdmin={isAdmin} />
      </div>
    </aside>
  );
}
