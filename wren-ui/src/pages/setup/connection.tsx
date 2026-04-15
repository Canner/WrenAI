import { useMemo } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import SetupConsoleLayout from '@/components/reference/SetupConsoleLayout';
import useSetupConnection from '@/hooks/useSetupConnection';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function SetupConnection() {
  const { connectError, dataSource, onBack, onNext, stepKey, submitting } =
    useSetupConnection();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SetupConsoleLayout
      title="接入数据源"
      description="连接真实数据库或直接使用内置电商 / HR 样例数据，快速完成知识库初始化。"
    >
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          connectError={connectError}
          dataSource={dataSource}
          onNext={onNext}
          onBack={onBack}
          submitting={submitting}
        />
      </ContainerCard>
    </SetupConsoleLayout>
  );
}
