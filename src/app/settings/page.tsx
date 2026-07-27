import { redirect } from "next/navigation";
import { resolveRequestScope } from "@/lib/request-scope";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import TelegramConnectCard from "@/components/TelegramConnectCard";
import SettingsForm from "@/components/SettingsForm";

export default async function SettingsPage() {
  const scoped = await resolveRequestScope();
  // Unauthenticated, or an account revoked after its JWT was issued — both
  // go back to login. Only a missing database falls through to the shell.
  if (!scoped.ok && scoped.reason !== "no_db") {
    redirect("/login");
  }

  const userName = scoped.userName;
  const dbReady = scoped.ok;
  const showClients = scoped.ok && scoped.role !== "investor";
  const profile = scoped.ok ? await scoped.store.loadProfile() : null;
  // The Telegram deep link binds a chat to the profile being viewed, so it
  // carries the SUBJECT's id, not the viewer's.
  const subjectId = scoped.ok ? scoped.scope.subjectId : "";

  if (profile && profile.onboarded === false) {
    redirect("/onboarding");
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0718] text-white">
      <Backdrop />

      <AppNav userName={userName} active="settings" showClients={showClients} />

      <section className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 pb-16 sm:px-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-white/60">
            Tune your buy box, financing, and alert bar. Osprey underwrites against these
            numbers on every scan.
          </p>
        </div>

        {!dbReady ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white">Settings not configured</p>
            <p className="mt-2 text-sm text-white/60">
              The database isn&apos;t connected in this environment, so settings can&apos;t be
              loaded or saved right now.
            </p>
          </div>
        ) : !profile ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 text-center backdrop-blur-md">
            <p className="text-sm font-medium text-white">No profile found</p>
            <p className="mt-2 text-sm text-white/60">
              We couldn&apos;t find your investor profile. Try signing in again.
            </p>
          </div>
        ) : (
          <>
            <SettingsForm profile={profile} />
            <TelegramConnectCard userId={subjectId} telegramChatId={profile.telegramChatId ?? null} />
          </>
        )}
      </section>
    </main>
  );
}
