import type { RenderEnvelope } from '@/envelope/types';
import type { ArtifactKind, PublishScope } from '@/session/types';

/**
 * Artifacts page domain types.
 *
 * Every GenBI output the agent has saved — a dashboard, a generated report, or
 * a single chart — is an "artifact". Reuses `ArtifactKind`/`PublishScope` from
 * the Ask session's event model (`@/session/types`) so a dashboard/report/chart
 * saved from an Ask turn (`ArtifactCard`/`PublishedCard`) and the same artifact
 * shown here carry identical kind/scope vocabulary.
 */
export type { ArtifactKind, PublishScope };

/** Where an artifact (or one dashboard tile) was derived from. */
export interface ArtifactSource {
  label: string;
  /** In-app link back to the originating Ask turn, if any. */
  href?: string;
}

/** The result of publishing an artifact: a shareable link plus its access scope. */
export interface ArtifactPublish {
  link: string;
  scope: PublishScope;
}

/** One tile in a dashboard artifact: a render envelope plus its own source. */
export interface DashboardTile {
  key: string;
  title: string;
  envelope: RenderEnvelope;
  source: ArtifactSource;
}

/** A generated report's preview: either a render envelope, or raw HTML shown as
 * an escaped text preview. HTML is never executed inline (no `dangerouslySetInnerHTML`) —
 * this is a *safe* preview only. */
export type ReportPreview =
  | { kind: 'envelope'; envelope: RenderEnvelope }
  | { kind: 'html'; html: string };

interface BaseArtifact {
  key: string;
  name: string;
  verified: boolean;
  createdAt: string;
  /** Generated file/output location within the project — always present
   * (it's part of the server's `ArtifactDto` metadata). */
  location: string;
  /** The session an artifact was produced in. Only present for live
   * (server-sourced) artifacts — needed to call the session-scoped publish
   * route (`POST /api/sessions/:sessionId/artifacts/:id/publish`). Absent
   * for fixtures, which publish via a local optimistic update instead. */
  sessionId?: string;
  /** Native retained output keeps its source in the Sessions namespace. */
  nativeSessionId?: string;
  /** Present once shared; absent means "not yet published". */
  publish?: ArtifactPublish;
}

/** The lightweight shape returned by the artifact list — enough for the
 * sidebar (kind icon + verified/shared indicators); per-kind detail fields
 * (tiles / preview / envelope) are hydrated lazily via `getArtifact`. */
export type ArtifactSummary = BaseArtifact & { kind: ArtifactKind };

/**
 * Per-kind rich detail (`tiles` / `source` / `preview` / `envelope`) is
 * optional on every kind below: `getArtifact` (see `bff/client.ts`) fetches
 * each artifact's persisted content from the server and merges it in when
 * that content is readable and matches the kind's expected shape, but the
 * server can only serve what was actually written — a metadata row whose
 * file has since gone missing, moved outside the artifacts root, or grown
 * past the read cap still resolves to a `BaseArtifact`-only `Artifact` with
 * no rich fields. Fixtures continue to supply the rich fields in full. Each
 * per-kind view (`DashboardView`/`ReportView`/`ChartView`) renders them
 * conditionally and degrades gracefully — never dereferences them assuming
 * presence.
 */
export interface DashboardArtifact extends BaseArtifact {
  kind: 'dashboard';
  tiles?: DashboardTile[];
  /** A live dashboard's persisted content has no per-tile title/source (the
   * saved envelope is one flat `blocks` array) — rendered as a single
   * envelope, never split into fabricated tiles. `tiles` stays fixture-only. */
  envelope?: RenderEnvelope;
  source?: ArtifactSource;
}

export interface ReportArtifact extends BaseArtifact {
  kind: 'report';
  source?: ArtifactSource;
  preview?: ReportPreview;
}

export interface ChartArtifact extends BaseArtifact {
  kind: 'chart';
  envelope?: RenderEnvelope;
  source?: ArtifactSource;
}

/** Full per-kind artifact detail — the discriminated union every detail view renders. */
export type Artifact = DashboardArtifact | ReportArtifact | ChartArtifact;
