import Link from "next/link";
import { signOut } from "@/auth";

/** Shared nav for signed-in pages (dashboard, settings). */
export default function AppNav({
  userName,
  active,
}: {
  userName: string;
  active: "dashboard" | "settings";
}) {
  const linkClass = (page: "dashboard" | "settings") =>
    active === page
      ? "text-white"
      : "text-white/60 transition hover:text-white";

  return (
    <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          Osprey
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className={linkClass("dashboard")}>
            Dashboard
          </Link>
          <Link href="/settings" className={linkClass("settings")}>
            Settings
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-sm text-white/60 sm:inline">{userName}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="text-sm text-white/60 transition hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
