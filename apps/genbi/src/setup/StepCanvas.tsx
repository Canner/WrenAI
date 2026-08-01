import { PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';
import { RuntimeStepCard } from './RuntimeStepCard';
import { ConnectStepCard } from './ConnectStepCard';
import { AdoptStepCard } from './AdoptStepCard';
import { ContextStepCard } from './ContextStepCard';
import { BindStepCard } from './BindStepCard';
import { AskStepCard } from './AskStepCard';

/**
 * Setup page canvas: renders the card for whichever step is selected in the
 * sidebar (`useSetupStore.selectedStepKey`) — same dispatcher pattern as
 * `HarnessPage` switching on its selected profile.
 */
export function StepCanvas() {
  const selectedStepKey = useSetupStore((s) => s.selectedStepKey);

  switch (selectedStepKey) {
    case 'runtime':
      return <RuntimeStepCard />;
    case 'connect':
      return <ConnectStepCard />;
    case 'adopt':
      return <AdoptStepCard />;
    case 'context':
      return <ContextStepCard />;
    case 'bind':
      return <BindStepCard />;
    case 'ask':
      return <AskStepCard />;
    default:
      return (
        <PageState
          status="empty"
          title={t('setup.emptyTitle')}
          description={t('setup.emptyDescription')}
        />
      );
  }
}
