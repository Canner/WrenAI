import { useMemo } from 'react';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import useSetupConnection from '@/hooks/useSetupConnection';
import { SETUP_STEPS } from '@/components/pages/setup/utils';

export default function SetupConnection() {
  const { connectError, dataSource, onBack, onNext, stepKey, submitting } =
    useSetupConnection();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);

  return (
    <SimpleLayout>
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          connectError={connectError}
          dataSource={dataSource}
          onNext={onNext}
          onBack={onBack}
          submitting={submitting}
        />
      </ContainerCard>
    </SimpleLayout>
  );
}
