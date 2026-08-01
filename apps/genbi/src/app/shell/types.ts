import type { ComponentType, ReactNode } from 'react';

/**
 * A top-level page. The registry of PageDefs is the single source of truth that
 * drives the top-bar nav, the router, and the contextual sidebar — add a page
 * in one place and all three pick it up.
 */
export interface PageDef {
  key: string;
  /** Route path, e.g. `/ask`. */
  path: string;
  label: string;
  /** AntD outline icon element (currentColor). */
  icon: ReactNode;
  /** Main canvas content. */
  Page: ComponentType;
  /** Contextual left-rail content for this page (omit for no rail). */
  Sidebar?: ComponentType;
}
