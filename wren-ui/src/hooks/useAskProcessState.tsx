import { useState } from 'react';
import { PROCESS_STATE } from '@/utils/enum';

export const getIsProcessing = (status: PROCESS_STATE) =>
  [
    PROCESS_STATE.UNDERSTANDING,
    PROCESS_STATE.PLANNING,
    PROCESS_STATE.GENERATING,
    PROCESS_STATE.SEARCHING,
  ].includes(status);

export default function useAskProcessState() {
  const [currentState, setCurrentState] = useState<PROCESS_STATE>(
    PROCESS_STATE.IDLE,
  );

  const resetState = () => {
    setCurrentState(PROCESS_STATE.IDLE);
  };

  const nextState = () => {
    setCurrentState(currentState + 1);
  };

  const setState = (state: PROCESS_STATE) => {
    setCurrentState(state);
  };

  return {
    currentState,
    resetState,
    nextState,
    setState,
  };
}
