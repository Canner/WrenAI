import { useMemo } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import SetupConsoleLayout from '@/components/reference/SetupConsoleLayout';
import useSetupModels from '@/hooks/useSetupModels';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function SetupModels() {
  const { fetching, stepKey, tables, onNext, onBack, submitting } =
    useSetupModels();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SetupConsoleLayout
      title="选择模型表"
      description="从当前数据源中挑选本次知识库需要纳入的核心表，后续再补关系和业务语义。"
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
