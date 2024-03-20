import { useState } from 'react';
import { PROCESS_STATE } from '@/utils/enum';

export default function useAskProcessState() {
  const [currentState, setCurrentState] = useState<PROCESS_STATE>(
    PROCESS_STATE.IDLE,
  );

  const resetState = () => {
    setCurrentState(PROCESS_STATE.IDLE);
  };

  const nextState = () => {
    setCurrentState(currentState + 1);
    console.log(currentState);
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
