import { redirect } from "next/navigation";
import { resolveRequestScope } from "@/lib/request-scope";
import Backdrop from "@/components/Backdrop";
import OnboardingWizard from "@/components/OnboardingWizard";

export default async function OnboardingPage() {
  const scoped = await resolveRequestScope();
  // Unauthenticated, or an account revoked after its JWT was issued — both go
  // back to login. Only a missing database falls through to the shell.
  if (!scoped.ok && scoped.reason !== "no_db") {
    redirect("/login");
  }

  const dbReady = scoped.ok;
  const profile = scoped.ok ? await scoped.store.loadProfile() : null;
  // The wizard's Telegram deep link binds a chat to the profile being set
  // up, so it carries the SUBJECT's id, not the viewer's.
  const subjectId = scoped.ok ? scoped.scope.subjectId : "";

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
          <OnboardingWizard
            userId={subjectId}
            initialConnected={profile.telegramChatId != null}
            saved={{
              city: (profile.buyBox.cities ?? [])[0] ?? "",
              state: (profile.buyBox.states ?? [])[0] ?? "",
              propertyTypes: profile.buyBox.propertyTypes,
              minPrice: profile.buyBox.minPrice ?? null,
              maxPrice: profile.buyBox.maxPrice ?? null,
              maxDaysOnMarket: profile.buyBox.maxDaysOnMarket ?? null,
              financingProfiles: profile.financingProfiles,
              minMonthlyCashFlow: profile.minMonthlyCashFlow,
            }}
          />
        )}
      </section>
    </main>
  );
}
