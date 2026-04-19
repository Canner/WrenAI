import { useMemo } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import SetupConsoleLayout from '@/components/reference/SetupConsoleLayout';
import useSetupConnection from '@/hooks/useSetupConnection';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function ManageSetupConnectionPage() {
  const { connectionType, connectError, onBack, onNext, stepKey, submitting } =
    useSetupConnection();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SetupConsoleLayout
      title="创建知识库连接"
      description="为当前知识库创建或更新主连接。系统样例已集中到系统样例空间，这里默认只处理真实业务数据接入。"
    >
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          connectError={connectError}
          connectionType={connectionType}
          onNext={onNext}
          onBack={onBack}
          submitting={submitting}
        />
      </ContainerCard>
    </SetupConsoleLayout>
  );
}
