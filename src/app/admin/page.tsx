// The operator user list. Read-only, by design — v1a exists so the guard and
// the audit plumbing are proven against production before anything here can
// change state (docs/ADMIN-UI-PLAN.md §9).
//
// Two independent gates, both required:
//   adminUiEnabled()  — does this surface exist at all (env kill switch)
//   requireAdmin()    — is the signed-in user on the allowlist
// Either failing produces notFound(). Never a 403: a signed-in non-admin who
// gets "forbidden" has learned the surface exists and that they are not on it.

import { notFound } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import AppNav from "@/components/AppNav";
import { requireAdmin } from "@/lib/require-admin";
import { ensureSchema } from "@/lib/db";
import { adminUiEnabled } from "@/lib/features";
import { isSelfAction } from "@/lib/admin-actions";
import AdminUserActions from "@/components/AdminUserActions";
import { PgStore, type AdminUserRow, type AdminAuditRow } from "@/osprey/pg-store";

export const metadata = { title: "Admin — Osprey" };

// Operator tooling must never be served from cache: a stale roster is how you
// promote the wrong account.
export const dynamic = "force-dynamic";

const cardClass =
  "glow-card rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-md";

function Pill({ text, tone }: { text: string; tone: string }) {
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${tone}`}>{text}</span>;
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === "agent"
      ? "border-indigo-400/30 bg-indigo-500/10 text-indigo-200"
      : role === "brokerage_admin"
        ? "border-violet-400/30 bg-violet-500/10 text-violet-200"
        : "border-white/15 bg-white/[0.06] text-white/55";
  return <Pill text={role} tone={tone} />;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : status === "suspended"
        ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
        : status === "invited"
          ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
          : "border-white/15 bg-white/[0.06] text-white/55";
  return <Pill text={status} tone={tone} />;
}

function UserRow({ user, actorEmail }: { user: AdminUserRow; actorEmail: string }) {
  return (
    <tr className="border-t border-white/[0.07]">
      <td className="py-3 pr-4">
        <div className="font-medium text-white/90">{user.name}</div>
        <div className="text-xs text-white/45">{user.email}</div>
      </td>
      <td className="py-3 pr-4">
        <RoleBadge role={user.role} />
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={user.status} />
      </td>
      <td className="py-3 pr-4 text-white/70">
        {user.clientCount > 0 ? user.clientCount : <span className="text-white/30">—</span>}
      </td>
      <td className="py-3 pr-4 text-white/70">
        {user.telegramBound ? "Bound" : <span className="text-white/30">—</span>}
      </td>
      <td className="py-3 pr-4 text-white/50">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="py-3">
        <AdminUserActions
          userId={user.id}
          role={user.role}
          status={user.status}
          isSelf={isSelfAction(actorEmail, user.email)}
        />
      </td>
    </tr>
  );
}

const ACTION_LABELS: Record<string, string> = {
  view_users: "viewed the user list",
  promote_agent: "promoted to agent",
  demote_agent: "demoted to investor",
  suspend: "suspended",
  reactivate: "reactivated",
};

function AuditRow({ entry }: { entry: AdminAuditRow }) {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 border-t border-white/[0.07] py-2 text-xs">
      <span className="text-white/50">{new Date(entry.createdAt).toLocaleString()}</span>
      <span className="text-white/70">{entry.actorEmail}</span>
      <span className="text-white/45">{label}</span>
      {entry.targetName && <span className="text-white/70">{entry.targetName}</span>}
      {/* A target id with no name means the account was deleted after the fact.
          The audit row outliving it is the point of an append-only log. */}
      {!entry.targetName && entry.targetUser && (
        <span className="text-white/30">(deleted account)</span>
      )}
    </li>
  );
}

function Shell({ userName, children }: { userName: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#07070b] text-white">
      <Backdrop />
      <AppNav userName={userName} active="admin" />
      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-4 sm:px-10">{children}</main>
    </div>
  );
}

export default async function AdminPage() {
  if (!adminUiEnabled()) notFound();

  const admin = await requireAdmin();
  // One response for every refusal — unauthenticated, not on the allowlist, and
  // no database all look identical from outside.
  if (!admin.ok) notFound();

  // Same reasoning as /r/[token]: this page can be the FIRST database entry
  // point hit after a deploy. Reaching it requires a session, but an operator
  // who was already signed in arrives on an existing cookie without passing
  // through authorize() — which is where ensureSchema() normally fires. Without
  // this, the first visit after the admin migration ships reads a table that
  // does not exist yet and 500s.
  await ensureSchema();

  const store = new PgStore();
  const users = await store.listUsersForAdmin();

  // Reading the full user list is the broadest read in the product, so it is
  // recorded on its own rather than only when something changes.
  await store.writeAdminAudit({
    actorEmail: admin.email,
    action: "view_users",
    detail: { count: users.length },
  });

  // Read AFTER the write above, so an operator's own arrival is the first line
  // they see — the log is visibly live rather than something they have to
  // trust is being written.
  const audit = await store.listAdminAudit(20);
  const agents = users.filter((u) => u.role === "agent").length;

  return (
    <Shell userName={admin.userName}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Users</h1>
          <p className="mt-1.5 text-sm text-white/55">
            {users.length} account{users.length === 1 ? "" : "s"} · {agents} agent
            {agents === 1 ? "" : "s"}
          </p>
        </div>
        <p className="text-xs text-white/35">Signed in as {admin.email}</p>
      </div>

      <div className={`${cardClass} mt-8 overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-white/35">
            <tr>
              <th className="pb-3 pr-4 font-medium">Account</th>
              <th className="pb-3 pr-4 font-medium">Role</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 pr-4 font-medium">Clients</th>
              <th className="pb-3 pr-4 font-medium">Telegram</th>
              <th className="pb-3 pr-4 font-medium">Joined</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} actorEmail={admin.email} />
            ))}
          </tbody>
        </table>
      </div>

      <div className={`${cardClass} mt-6`}>
        <h2 className="text-sm font-medium text-white">Recent operator actions</h2>
        <p className="mt-1 text-xs text-white/40">
          Append-only. There is no edit or delete path — an audit log you can edit is not
          an audit log.
        </p>
        <ul className="mt-3">
          {audit.map((e, i) => (
            <AuditRow key={`${e.createdAt}-${i}`} entry={e} />
          ))}
        </ul>
      </div>

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-white/35">
        Account metadata only. Buy boxes, financing, cash-flow targets, verdicts, and
        reports are deliberately not shown here and are not read by this page — see
        docs/ADMIN-UI-PLAN.md §4. Suspending an account revokes its session on the next
        request. Waitlist invites arrive in v1c.
      </p>
    </Shell>
  );
}
