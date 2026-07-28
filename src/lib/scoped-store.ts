// A PgStore whose user id is already bound to an authorized Scope.
//
// This is the enforcement mechanism for threat T1 (IDOR). Rather than branding
// PgStore's parameters — which would fight the Store interface the agent core
// implements against — the scoped methods take NO user id at all. A route
// holding a ScopedStore cannot pass the wrong user's id, because there is no
// id parameter to pass. Holding one IS the authorization.
//
// Usage in a request handler:
//
//     const scope = await resolveScope(session.user.id, clientIdFromRequest);
//     if (!scope) return notPermitted();          // same response for
//     const store = scopedStore(scope);           // "forbidden" and "no such
//     const profile = await store.loadProfile();  // user" — see threat T4
//
// System contexts (cron scan, Telegram webhook) legitimately act for every
// user and keep using PgStore directly with systemSubject().

import { PgStore, type ReportRow, type ShareLinkRow } from "@/osprey/pg-store";
import type { Scope, SubjectId } from "@/lib/scope";
import type { InvestorProfile } from "@/osprey/agent/model";
import type { VerdictRecord } from "@/osprey/agent/loop";

/** Thrown when a read-only scope attempts a write. Distinct from "not
 *  permitted at all", which resolveScope() already handled by returning null. */
export class ScopeWriteError extends Error {
  constructor() {
    super("This scope is read-only.");
    this.name = "ScopeWriteError";
  }
}

/**
 * Fields an agent may not read off a client's profile.
 *
 * `tasteNotes` are written verbatim from what the client types to the Telegram
 * bot (`src/osprey/agent/messenger/actions.ts` appends `intent.reason`, the
 * client's own words) — a conversation the client reasonably believes is
 * between them and Osprey. `telegramChatId` is a durable identifier for a
 * third-party messaging account.
 *
 * Neither is rendered by the client detail page today. The redaction is here
 * anyway because privacy obligations attach to what the authorization layer
 * PERMITS, not to what the current UI happens to use — the UI is one commit
 * away from changing, and a promise kept by convention is not kept. Doing it
 * at the boundary is what makes the consent screen's "what your agent can
 * see" list true by construction.
 *
 * See docs/PRIVACY-TOS-AGENT-DRAFT.md §A1-A2.
 */
function redactForAgent(profile: InvestorProfile): InvestorProfile {
  const { tasteNotes: _notes, telegramChatId: _chat, ...rest } = profile;
  void _notes;
  void _chat;
  return rest;
}

export class ScopedStore {
  readonly scope: Scope;
  private readonly store: PgStore;

  constructor(scope: Scope, store: PgStore = new PgStore()) {
    this.scope = scope;
    this.store = store;
  }

  /** The authorized subject, for the rare call that genuinely needs the raw id
   *  (e.g. building a share URL). Returns the BRANDED type: handing it to an
   *  unscoped PgStore method still requires an explicit cast, which keeps
   *  every bypass greppable rather than letting a plain string leak out. */
  get subjectId(): SubjectId {
    return this.scope.subjectId;
  }

  private assertWritable(): void {
    if (!this.scope.canEdit) throw new ScopeWriteError();
  }

  // --- Profile -------------------------------------------------------------

  async loadProfile(): Promise<InvestorProfile | null> {
    const profile = await this.store.loadProfile(this.scope.subjectId);
    if (!profile) return null;
    return this.scope.relation === "agent_of_client" ? redactForAgent(profile) : profile;
  }

  /** Settings-style write: never touches telegram_chat_id, which is owned by
   *  the webhook's /start binding. The profile's own id is forced to the
   *  authorized subject so a tampered payload cannot redirect the write. */
  async saveProfileSettings(profile: InvestorProfile): Promise<void> {
    this.assertWritable();
    const next: InvestorProfile = { ...profile, id: this.scope.subjectId };

    if (this.scope.relation === "agent_of_client") {
      // The agent read this profile through loadProfile() above, so the object
      // they are handing back has no tasteNotes — writing it verbatim would
      // blank a field they were deliberately never shown. Restore from storage:
      // redaction must not become deletion. (telegramChatId needs no equivalent;
      // PgStore.saveProfileSettings drops it on every write.)
      const stored = await this.store.loadProfile(this.scope.subjectId);
      if (stored?.tasteNotes) next.tasteNotes = stored.tasteNotes;
    }

    return this.store.saveProfileSettings(next);
  }

  // --- Verdicts ------------------------------------------------------------

  loadRecentVerdicts(limit = 5): Promise<VerdictRecord[]> {
    return this.store.loadRecentVerdicts<VerdictRecord>(this.scope.subjectId, limit);
  }

  loadVerdictsSince(since: Date): Promise<VerdictRecord[]> {
    return this.store.loadVerdictsSince(this.scope.subjectId, since);
  }

  /** The property-feature gate: you only model properties from your own feed
   *  (or, as an agent, from your client's). */
  loadVerdictForListing(listingId: string): Promise<VerdictRecord | null> {
    return this.store.loadVerdictForListing(this.scope.subjectId, listingId);
  }

  // --- Reports -------------------------------------------------------------

  getReport<T = unknown>(listingId: string): Promise<ReportRow<T> | null> {
    return this.store.getReport<T>(this.scope.subjectId, listingId);
  }

  async upsertReportGenerating(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.upsertReportGenerating(this.scope.subjectId, listingId);
  }

  async saveReportReady(listingId: string, report: unknown, model: string): Promise<void> {
    this.assertWritable();
    return this.store.saveReportReady(this.scope.subjectId, listingId, report, model);
  }

  async markReportFailed(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.markReportFailed(this.scope.subjectId, listingId);
  }

  /**
   * Report generations to charge against the rate limit.
   *
   * Counts the ACTOR (scope.viewerId), not the subject. Counting the subject
   * would multiply the limit by an agent's client count — 50 clients would buy
   * 50x the paid LLM budget, all attributable to one agent. For a self scope
   * the two ids are identical, so solo investors are unaffected.
   */
  countReportsSince(since: Date): Promise<number> {
    return this.store.countReportsSince(this.scope.viewerId, since);
  }

  // --- Share links ---------------------------------------------------------

  async createShareLink(listingId: string): Promise<string> {
    this.assertWritable();
    return this.store.createShareLink(this.scope.subjectId, listingId);
  }

  async revokeShareLink(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.revokeShareLink(this.scope.subjectId, listingId);
  }

  listShareLinks(): Promise<ShareLinkRow[]> {
    return this.store.listShareLinks(this.scope.subjectId);
  }

  /** Append a verdict to the subject's ledger. investorId is forced to the
   *  authorized subject: the record is assembled from engine output, and a
   *  mismatched id would write into someone else's feed. */
  async appendVerdict(record: VerdictRecord): Promise<void> {
    this.assertWritable();
    return this.store.appendVerdict({ ...record, investorId: this.scope.subjectId });
  }

  // --- Unscoped passthroughs ----------------------------------------------
  // Listing snapshots and price history are properties of a LISTING, not of a
  // user, so they carry no per-user authorization. Access to the page that
  // shows them is gated by loadVerdictForListing above.

  loadSnapshot(listingId: string) {
    return this.store.loadSnapshot(listingId);
  }

  loadEventsForListing(listingId: string) {
    return this.store.loadEventsForListing(listingId);
  }

  /** Listing snapshots are shared across all users — cached RentCast payloads
   *  keyed by listing, carrying no per-user data. */
  saveSnapshot(
    ...args: Parameters<PgStore["saveSnapshot"]>
  ): ReturnType<PgStore["saveSnapshot"]> {
    return this.store.saveSnapshot(...args);
  }

  /** Keyed by Telegram chat + message, not by user. The chat binding itself is
   *  owned by the webhook's /start flow. */
  saveTgAnchor(chatId: number, messageId: number, listingId: string): Promise<void> {
    return this.store.saveTgAnchor(chatId, messageId, listingId);
  }
}

export function scopedStore(scope: Scope, store?: PgStore): ScopedStore {
  return new ScopedStore(scope, store);
}
