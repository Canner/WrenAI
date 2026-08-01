import { Component, type ReactNode } from 'react';
import { Alert } from 'antd';
import { t } from '@/i18n/strings';

interface Props {
  children: ReactNode;
  /** Rendered instead of the default alert when a child throws. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Contains render-time errors so a single bad subtree degrades to an inline
 * notice instead of blanking the whole app. Used per-block in EnvelopeView:
 * a malformed answer block (e.g. a live agent emitting a `table` with no
 * columns/rows) shows a "couldn't render" card while its siblings survive.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Alert
            type="warning"
            showIcon
            message={t('envelope.couldNotRender')}
            description={this.state.message}
          />
        )
      );
    }
    return this.props.children;
  }
}
