import { useMemo } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import SetupConsoleLayout from '@/components/reference/SetupConsoleLayout';
import useSetupModels from '@/hooks/useSetupModels';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function ManageSetupModelsPage() {
  const { fetching, stepKey, tables, onNext, onBack, submitting } =
    useSetupModels();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SetupConsoleLayout
      title="选择知识库资产"
      description="从当前知识库主连接中挑选本次需要纳入的核心资产，后续再补关系和业务语义。"
    >
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          fetching={fetching}
          onBack={onBack}
          onNext={onNext}
          submitting={submitting}
          tables={tables}
        />
      </ContainerCard>
    </SetupConsoleLayout>
  );
}
