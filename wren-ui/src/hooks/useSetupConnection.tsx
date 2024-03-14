import { useState } from 'react';
import { DATA_SOURCES, SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';

export default function useSetupConnection() {
  const [stepKey, setStepKey] = useState(SETUP.STARTER);
  const [dataSource, setDataSource] = useState(DATA_SOURCES.BIG_QUERY);
  const router = useRouter();

  const submitDataSource = async (_data: any) => {
    // TODO: implement submitDataSource API
    router.push('/setup/models');
  };

  const onBack = () => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setStepKey(SETUP.STARTER);
    }
  };

  const onNext = (data?: { dataSource: DATA_SOURCES }) => {
    if (stepKey === SETUP.STARTER) {
      if (data.dataSource) {
        setDataSource(data?.dataSource);
        setStepKey(SETUP.CREATE_DATA_SOURCE);
      } else {
        // TODO: implement template chosen
      }
    } else if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      submitDataSource(data);
    }
  };

  return {
    stepKey,
    dataSource,
    onBack,
    onNext,
  };
}
