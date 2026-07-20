import { Utensils } from "lucide-react";
import { NavLinks } from "./nav-links";
import { getSession } from "@/lib/auth/current-session";

export async function Sidebar() {
  const session = await getSession();
  const isDriver = session?.role === "driver";

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Utensils className="size-5 text-primary" />
        <span className="text-lg font-semibold">CRM</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks isDriver={isDriver} />
      </div>
    </aside>
  );
}
