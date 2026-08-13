import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { NavLinks } from "./nav-links";
import { getSession } from "@/lib/auth/current-session";
import { ROLE_LABELS } from "@/lib/constants/role-labels";

export async function Sidebar() {
  const session = await getSession();
  const isDriver = session?.role === "driver";
  const isAdmin = session?.role === "admin";

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <OrdifyLogo variant="full" />
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-3">
        <NavLinks
          isDriver={isDriver}
          isAdmin={isAdmin}
          username={session?.username}
          roleLabel={session ? ROLE_LABELS[session.role] : undefined}
        />
      </div>
    </aside>
  );
}
