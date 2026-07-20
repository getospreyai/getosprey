import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Backdrop from "@/components/Backdrop";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import OnboardingWizard from "@/components/OnboardingWizard";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;
  const dbReady = hasDb();
  const profile = dbReady ? await new PgStore().loadProfile(userId) : null;

  if (profile?.onboarded === true) {
    redirect("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <nav className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <span className="text-sm font-semibold tracking-tight">Osprey</span>
        <a
          href="mailto:hello@getosprey.ai"
          className="text-sm text-white/60 transition hover:text-white"
        >
          Need help?
        </a>
      </nav>

      <section className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-16 sm:px-10">
        {!dbReady || !profile ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white">Onboarding not available</p>
            <p className="mt-2 text-sm text-white/60">
              We couldn&apos;t load your account right now. Try signing in again.
            </p>
          </div>
        ) : (
          <OnboardingWizard userId={userId} />
        )}
      </section>
    </main>
  );
}
