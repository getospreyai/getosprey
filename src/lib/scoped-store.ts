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
import type { Scope } from "@/lib/scope";
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

export class ScopedStore {
  readonly scope: Scope;
  private readonly store: PgStore;

  constructor(scope: Scope, store: PgStore = new PgStore()) {
    this.scope = scope;
    this.store = store;
  }

  /** The authorized subject, for the rare call that genuinely needs the raw id
   *  (e.g. building a share URL). Reading it is fine; it is already checked. */
  get subjectId(): string {
    return this.scope.subjectId;
  }

  private assertWritable(): void {
    if (!this.scope.canEdit) throw new ScopeWriteError();
  }

  // --- Profile -------------------------------------------------------------

  loadProfile(): Promise<InvestorProfile | null> {
    return this.store.loadProfile(this.scope.subjectId);
  }

  /** Settings-style write: never touches telegram_chat_id, which is owned by
   *  the webhook's /start binding. The profile's own id is forced to the
   *  authorized subject so a tampered payload cannot redirect the write. */
  saveProfileSettings(profile: InvestorProfile): Promise<void> {
    this.assertWritable();
    return this.store.saveProfileSettings({ ...profile, id: this.scope.subjectId });
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

  upsertReportGenerating(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.upsertReportGenerating(this.scope.subjectId, listingId);
  }

  saveReportReady(listingId: string, report: unknown, model: string): Promise<void> {
    this.assertWritable();
    return this.store.saveReportReady(this.scope.subjectId, listingId, report, model);
  }

  markReportFailed(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.markReportFailed(this.scope.subjectId, listingId);
  }

  countReportsSince(since: Date): Promise<number> {
    return this.store.countReportsSince(this.scope.subjectId, since);
  }

  // --- Share links ---------------------------------------------------------

  createShareLink(listingId: string): Promise<string> {
    this.assertWritable();
    return this.store.createShareLink(this.scope.subjectId, listingId);
  }

  revokeShareLink(listingId: string): Promise<void> {
    this.assertWritable();
    return this.store.revokeShareLink(this.scope.subjectId, listingId);
  }

  listShareLinks(): Promise<ShareLinkRow[]> {
    return this.store.listShareLinks(this.scope.subjectId);
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
}

export function scopedStore(scope: Scope, store?: PgStore): ScopedStore {
  return new ScopedStore(scope, store);
}
