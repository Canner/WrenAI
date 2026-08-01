import { Button, Popconfirm } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useSetupStore } from './useSetupStore';
import { StepStatusTag } from './StepStatusTag';

/**
 * Setup page's contextual sidebar: the onboarding steps, each showing its
 * progress via `StepStatusTag` (icon+label, not color alone). Selecting a
 * step shows its card in the canvas — same controlled-selection pattern as
 * `HarnessSidebar` / `ContextSidebar`, but with a custom list (rather than
 * the generic `SidebarList`) so each row can carry a status tag. Hidden
 * entirely (live mode only) until a create/adopt mode is chosen — see
 * `SetupPage`'s `SetupModeChoice` gating.
 */
export function SetupSidebar() {
  const steps = useSetupStore((s) => s.steps);
  const selectedStepKey = useSetupStore((s) => s.selectedStepKey);
  const selectStep = useSetupStore((s) => s.selectStep);
  const resetSetup = useSetupStore((s) => s.resetSetup);
  const setupMode = useSetupStore((s) => s.setupMode);

  if (isBffEnabled() && !setupMode) return null;

  return (
    <nav aria-label={t('setup.stepsHeader')} style={{ padding: 12 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ant-color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          padding: '4px 8px',
        }}
      >
        {t('setup.stepsHeader')}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((step, index) => {
          const selected = step.key === selectedStepKey;
          return (
            <li key={step.key}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => selectStep(step.key)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  alignItems: 'flex-start',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 8px',
                  marginBottom: 2,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: selected ? 'var(--ant-color-fill-secondary)' : 'transparent',
                  color: 'var(--ant-color-text)',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: selected ? 600 : 400 }}>
                  {index + 1}. {step.title}
                </span>
                {/* `ask` is the terminal step — reaching it means setup is done,
                    there's nothing "in progress" to complete — so suppress its
                    status tag once it's the current step (the selected-row
                    highlight already marks it active). It still shows "Todo"
                    beforehand. */}
                {!(step.key === 'ask' && step.state === 'current') && (
                  <StepStatusTag state={step.state} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div style={{ padding: '8px' }}>
        <Popconfirm
          title={t('setup.resetConfirmTitle')}
          description={<div style={{ maxWidth: 260 }}>{t('setup.resetConfirmDescription')}</div>}
          okText={t('setup.resetConfirmOk')}
          cancelText={t('setup.resetConfirmCancel')}
          okButtonProps={{ danger: true }}
          onConfirm={() => resetSetup()}
        >
          <Button type="text" danger size="small" icon={<ReloadOutlined />}>
            {t('setup.resetAction')}
          </Button>
        </Popconfirm>
      </div>
    </nav>
  );
}
