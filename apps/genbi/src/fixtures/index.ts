/**
 * Fixture / mock-data layer.
 *
 * Phase 1a is fixture-driven: the UI renders entirely from these mocks with NO
 * backend. When the BFF lands (Phase 1b), stores swap their source
 * from here to live HTTP/SSE without the view layer changing. Keep everything
 * here obviously fake and free of any private/customer data (public repo).
 */

export interface SidebarItem {
  key: string;
  label: string;
  meta?: string;
  /** Renders greyed and non-interactive (e.g. a Phase-3 placeholder not yet bindable). */
  disabled?: boolean;
}

export const fixtureSessions: SidebarItem[] = [
  { key: 's1', label: 'Top customers by revenue', meta: 'Verified · 2m ago' },
  { key: 's2', label: 'Monthly signups trend', meta: 'Verified · 1h ago' },
  { key: 's3', label: 'Churn by plan', meta: 'Estimate · yesterday' },
];
