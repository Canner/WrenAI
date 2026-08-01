import type { ReactNode } from 'react';
import { Button, Empty, Result, Spin } from 'antd';
import { t } from '@/i18n/strings';

type Status = 'loading' | 'empty' | 'error';

interface PageStateProps {
  status: Status;
  title?: ReactNode;
  description?: ReactNode;
  /** Shown for `empty` (e.g. a primary CTA) or as the error retry handler. */
  action?: ReactNode;
  onRetry?: () => void;
}

/**
 * Canonical loading / empty / error states. Every page must define all three,
 * including a first-run empty state, so no view ever renders blank.
 */
export function PageState({ status, title, description, action, onRetry }: PageStateProps) {
  const wrap = (node: ReactNode) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 240,
        padding: 24,
      }}
      role="status"
    >
      {node}
    </div>
  );

  if (status === 'loading') {
    return wrap(<Spin tip={title ?? t('state.loading')} size="large" />);
  }

  if (status === 'error') {
    return wrap(
      <Result
        status="warning"
        title={title ?? t('state.errorTitle')}
        subTitle={description}
        extra={
          action ??
          (onRetry && (
            <Button type="primary" onClick={onRetry}>
              {t('state.retry')}
            </Button>
          ))
        }
      />,
    );
  }

  return wrap(
    <Empty
      description={
        <div>
          <div>{title ?? t('state.emptyTitle')}</div>
          {description != null && (
            <div style={{ opacity: 0.65, marginTop: 4 }}>{description}</div>
          )}
        </div>
      }
    >
      {action}
    </Empty>,
  );
}
