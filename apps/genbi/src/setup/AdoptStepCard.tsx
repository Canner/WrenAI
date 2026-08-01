import { useState } from 'react';
import { Alert, Button, Input, Space, Typography } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';
import { DecisionCard } from './DecisionCard';

/**
 * Adopt step: points the wizard at an existing wren project directory
 * instead of scaffolding a new one. `POST /api/setup/adopt` verifies the
 * path synchronously (no stream) and can land on one of three outcomes:
 * - already verified with a built context ("ok") — binds immediately and
 *   advances past `context` straight to `bind`.
 * - no `profile:` pin yet, but compatible profiles exist ("needs_decision",
 *   `decision.kind === 'select_profile'`) — reuses the generic
 *   `DecisionCard` to let the user pick one, but routes the choice back
 *   through `adoptProject(path, chosenProfile)` (a plain re-verify carrying
 *   the pin to write) rather than `resolveAdoptDecision` — there is no
 *   server-side session for this checkpoint, just a pin to durably write via
 *   `wren context set-profile` before re-checking the connection. If that
 *   pick fails (incompatible profile, or a live connection check that fails
 *   after passing compatibility), the store re-shows the same candidate list
 *   alongside the error instead of dropping it — see `adoptProject`'s doc
 *   comment — so the picker and the error render together below.
 * - already pinned but not yet built ("needs_decision",
 *   `decision.kind === 'build_context'`, same as before) — "Build" hands off
 *   to the existing context-step stream, "Cancel" returns to the mode
 *   choice screen, both via `resolveAdoptDecision`.
 * A plain path-verify failure shows an inline error with the path left
 * editable for a retry.
 */
export function AdoptStepCard() {
  const adoptStream = useSetupStore((s) => s.adoptStream);
  const adoptProject = useSetupStore((s) => s.adoptProject);
  const resolveAdoptDecision = useSetupStore((s) => s.resolveAdoptDecision);
  const [projectPath, setProjectPath] = useState('');

  const { verifying, error, decision, resolving } = adoptStream;
  const inputLocked = verifying || Boolean(decision);
  const canSubmit = projectPath.trim().length > 0 && !inputLocked;
  const isSelectProfile = decision?.kind === 'select_profile';

  const note = verifying ? t('setup.adoptVerifyingNote') : t('setup.adoptDescription');

  return (
    <Panel title={t('setup.adoptTitle')} note={note}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <label style={{ display: 'block' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            {t('setup.adoptPathLabel')}
          </Typography.Text>
          <Input
            placeholder={t('setup.adoptPathPlaceholder')}
            value={projectPath}
            disabled={inputLocked}
            onChange={(e) => setProjectPath(e.target.value)}
          />
        </label>
        <Button
          type="primary"
          disabled={!canSubmit}
          loading={verifying}
          onClick={() => adoptProject(projectPath.trim())}
        >
          {t('setup.adoptAction')}
        </Button>

        {error && (
          <Alert type="error" showIcon message={t('setup.adoptErrorTitle')} description={error} />
        )}

        {decision && (
          <DecisionCard
            decision={decision}
            resolving={isSelectProfile ? verifying : resolving}
            onChoose={
              isSelectProfile
                ? (profileName) => adoptProject(projectPath.trim(), profileName)
                : resolveAdoptDecision
            }
          />
        )}
      </Space>
    </Panel>
  );
}
