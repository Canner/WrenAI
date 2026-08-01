import { useEffect } from 'react';
import { PageContainer } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useSetupStore } from './useSetupStore';
import { ConversationView } from './ConversationView';
import { StepCanvas } from './StepCanvas';
import { SetupModeChoice } from './SetupModeChoice';

/**
 * Setup page: an agent-guided, first-run flow (runtime & models → connect or
 * adopt a project → build context → bind profile → ask). The conversation
 * transcript sits above the current step's card; the flow is entirely
 * card-driven — there's no free-text input. Step progress and selection live
 * in `useSetupStore` — see `SetupSidebar` for how a step is selected. With no
 * `VITE_BFF_URL` set, everything is fixture-driven (always behaves as the
 * "create" mode) and buttons on each step's card advance state locally; when
 * the BFF is enabled, steps + runtime settings are also hydrated from it on
 * mount, and the wizard opens on a create/adopt mode choice until one is
 * picked (see `SetupModeChoice`).
 */
export function SetupPage() {
  const messages = useSetupStore((s) => s.messages);
  const hydrate = useSetupStore((s) => s.hydrate);
  const setupMode = useSetupStore((s) => s.setupMode);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const showModeChoice = isBffEnabled() && !setupMode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <PageContainer maxWidth={720} title={t('nav.setup')} lead={t('setup.pageLead')}>
          {showModeChoice ? (
            <SetupModeChoice />
          ) : (
            <>
              <ConversationView messages={messages} />
              <StepCanvas />
            </>
          )}
        </PageContainer>
      </div>
    </div>
  );
}
