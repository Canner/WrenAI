import { DataSourceName } from '@/types/dataSource';
import { useState, useEffect } from 'react';
import { SETUP } from '@/utils/enum';
import { parseOperationError } from '@/utils/errorHandler';
import useSetupConnectionType from './useSetupConnectionType';

type StepData = {
  connectionType?: DataSourceName;
  properties?: Record<string, any>;
};

export default function useSetupConnection() {
  const [stepKey, setStepKey] = useState(SETUP.STARTER);
  const setupConnectionType = useSetupConnectionType();
  const [connectError, setConnectError] =
    useState<ReturnType<typeof parseOperationError>>(null);

  const connectionType = setupConnectionType.selectedConnectionType;
  const submitting = setupConnectionType.loading;

  useEffect(() => {
    if (stepKey === SETUP.CREATE_CONNECTION) {
      setConnectError(null);
    }
  }, [stepKey]);

  useEffect(() => {
    if (setupConnectionType.error) {
      const nextError = setupConnectionType.error;
      const parsedError = parseOperationError(
        nextError as Parameters<typeof parseOperationError>[0],
      ) || {
        message: nextError.message,
        shortMessage: nextError.message,
        code: '',
        stacktrace: undefined,
      };
      setConnectError(parsedError);
      return;
    }
    setConnectError(null);
  }, [setupConnectionType.error]);

  const onBack = () => {
    if (stepKey === SETUP.CREATE_CONNECTION) {
      setStepKey(SETUP.STARTER);
      setupConnectionType.reset();
    }
  };

  const onNext = (data?: StepData) => {
    if (!data) {
      return;
    }

    const dispatchStarter = (data: StepData) => {
      if (data.connectionType) {
        setupConnectionType.selectConnectionType({
          connectionType: data.connectionType,
          dispatch: () => setStepKey(SETUP.CREATE_CONNECTION),
        });
      }
    };

    const dispatchCreateConnection = (data: StepData) => {
      void setupConnectionType.saveConnection(data.properties);
    };

    // Next strategy
    if (stepKey === SETUP.STARTER) {
      dispatchStarter(data);
    } else if (stepKey === SETUP.CREATE_CONNECTION) {
      dispatchCreateConnection(data);
    }
  };

  return {
    stepKey,
    connectionType,
    onBack,
    onNext,
    submitting,
    connectError,
  };
}
