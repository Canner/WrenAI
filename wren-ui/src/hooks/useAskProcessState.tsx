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

export class ProcessStateMachine {
  private static transitions = {
    [PROCESS_STATE.IDLE]: {
      next: [PROCESS_STATE.UNDERSTANDING],
      prev: [],
    },
    [PROCESS_STATE.UNDERSTANDING]: {
      next: [PROCESS_STATE.SEARCHING, PROCESS_STATE.FAILED],
      prev: [PROCESS_STATE.IDLE],
    },
    [PROCESS_STATE.SEARCHING]: {
      next: [PROCESS_STATE.PLANNING, PROCESS_STATE.FAILED],
      prev: [PROCESS_STATE.UNDERSTANDING],
    },
    [PROCESS_STATE.PLANNING]: {
      next: [PROCESS_STATE.GENERATING, PROCESS_STATE.FAILED],
      prev: [PROCESS_STATE.SEARCHING],
    },
    [PROCESS_STATE.GENERATING]: {
      next: [
        PROCESS_STATE.CORRECTING,
        PROCESS_STATE.FINISHED,
        PROCESS_STATE.FAILED,
      ],
      prev: [PROCESS_STATE.PLANNING],
    },
    [PROCESS_STATE.CORRECTING]: {
      next: [PROCESS_STATE.FINISHED, PROCESS_STATE.FAILED],
      prev: [PROCESS_STATE.GENERATING],
    },
    [PROCESS_STATE.FINISHED]: {
      next: [],
      prev: [PROCESS_STATE.GENERATING, PROCESS_STATE.CORRECTING],
    },
  };

  static canTransition(from: PROCESS_STATE, to: PROCESS_STATE) {
    return this.transitions[from]?.next.includes(to);
  }

  static getNextStates(state: PROCESS_STATE) {
    return this.transitions[state]?.next || [];
  }

  static getAllNextStates(state: PROCESS_STATE, includeSelf = false) {
    const allNextStates = new Set<PROCESS_STATE>(includeSelf ? [state] : []);
    const collectNextStates = (currentState: PROCESS_STATE) => {
      const nextStates = this.transitions[currentState]?.next || [];
      nextStates.forEach((nextState) => {
        if (!allNextStates.has(nextState)) {
          allNextStates.add(nextState);
          collectNextStates(nextState);
        }
      });
    };
    collectNextStates(state);
    return Array.from(allNextStates);
  }
}
