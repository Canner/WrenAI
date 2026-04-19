import { useMemo } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import SetupConsoleLayout from '@/components/reference/SetupConsoleLayout';
import useSetupRelations from '@/hooks/useSetupRelations';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function ManageSetupRelationshipsPage() {
  const {
    fetching,
    stepKey,
    recommendRelationsResult,
    onNext,
    onBack,
    onSkip,
    submitting,
  } = useSetupRelations();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SetupConsoleLayout
      title="定义资产关系"
      description="确认知识库资产间关联关系，确保后续问答、SQL 生成和图表聚合能基于统一语义执行。"
    >
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          fetching={fetching}
          {...recommendRelationsResult}
          onNext={onNext}
          onBack={onBack}
          onSkip={onSkip}
          submitting={submitting}
        />
      </ContainerCard>
    </SetupConsoleLayout>
  );
}
