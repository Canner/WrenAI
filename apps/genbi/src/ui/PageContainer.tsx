import type { ReactNode } from 'react';
import { Typography } from 'antd';
import './pageContainer.css';

export interface PageContainerProps {
  /** Column width in px. Mockup per-page values: Context 1180, standard pages 1000 (default), Ask thread 840, Setup steps column 720. */
  maxWidth?: number;
  /** Rendered as a real heading — every page that sets this gets exactly one accessible page heading. */
  title?: ReactNode;
  /** Muted, ~64ch-max description line under the title. */
  lead?: ReactNode;
  /** Right-aligned actions next to the title. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Shared page-framing primitive: a centered column at `maxWidth` with the
 * design reference's horizontal padding and top/bottom breathing room, an
 * optional header (real heading + muted lead + right-aligned actions), and
 * 16px vertical rhythm between sections. Every canvas page should render
 * through this instead of an ad-hoc wrapper div, so cross-page whitespace
 * stays consistent.
 */
export function PageContainer({
  maxWidth = 1000,
  title,
  lead,
  actions,
  children,
  className,
}: PageContainerProps) {
  return (
    <div className={['genbi-page', className].filter(Boolean).join(' ')} style={{ maxWidth }}>
      {title != null && (
        <div className="genbi-page-head">
          <div className="genbi-page-head-text">
            <Typography.Title level={2} className="genbi-page-title">
              {title}
            </Typography.Title>
            {lead != null && <p className="genbi-page-lead">{lead}</p>}
          </div>
          {actions != null && <div className="genbi-page-actions">{actions}</div>}
        </div>
      )}
      <div className="genbi-page-body">{children}</div>
    </div>
  );
}
