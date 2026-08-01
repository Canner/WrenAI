import { Button, Space, Typography } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import type { SetupDecision } from '@/bff/client';

interface DecisionCardProps {
  decision: SetupDecision;
  /** True while a choice is being resolved (the POST to `/api/setup/decision` is in flight) — disables every button. */
  resolving: boolean;
  onChoose: (choiceId: string) => void;
}

/**
 * Generic decision checkpoint card: `detail` plus one button per option, in
 * the same nested-`Panel` visual style as the connect step's credential-form
 * pause. Renders every checkpoint kind the setup flow defines —
 * `max_turns_continue` (continue/stop, mid context turn), `name_conflict`
 * (rename/clean/cancel, pre-turn on connect), `build_context` (build/cancel,
 * post-verify on adopt), and `select_profile` (one button per candidate
 * profile, pre-verify on adopt) — without switching on `kind`: `options`/
 * `detail` already carry everything needed to render any of them. Callers
 * decide what `onChoose` actually does per kind (see `AdoptStepCard`, which
 * routes `select_profile` differently from the rest).
 */
export function DecisionCard({ decision, resolving, onChoose }: DecisionCardProps) {
  return (
    <Panel title={t('setup.decisionTitle')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {decision.detail && <Typography.Text>{decision.detail}</Typography.Text>}
        <Space wrap>
          {decision.options.map((option, index) => (
            <Button
              key={option.id}
              type={index === 0 ? 'primary' : 'default'}
              disabled={resolving}
              loading={resolving}
              onClick={() => onChoose(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </Space>
      </Space>
    </Panel>
  );
}
