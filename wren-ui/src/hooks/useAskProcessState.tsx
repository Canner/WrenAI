import { useState } from 'react';
import { PROCESS_STATE } from '@/utils/enum';
import {
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
} from '@/apollo/client/graphql/__types__';

export const getIsProcessing = (status: PROCESS_STATE) =>
  [
    PROCESS_STATE.UNDERSTANDING,
    PROCESS_STATE.SEARCHING,
    PROCESS_STATE.PLANNING,
    PROCESS_STATE.GENERATING,
    PROCESS_STATE.CORRECTING,
  ].includes(status);

export const convertAskingTaskToProcessState = (data: AskingTask) => {
  if (!data) return null;

  const processState = {
    [AskingTaskStatus.UNDERSTANDING]: PROCESS_STATE.UNDERSTANDING,
    [AskingTaskStatus.SEARCHING]: PROCESS_STATE.SEARCHING,
    [AskingTaskStatus.PLANNING]: PROCESS_STATE.PLANNING,
    [AskingTaskStatus.GENERATING]: PROCESS_STATE.GENERATING,
    [AskingTaskStatus.CORRECTING]: PROCESS_STATE.CORRECTING,
    [AskingTaskStatus.FINISHED]: PROCESS_STATE.FINISHED,
    [AskingTaskStatus.STOPPED]: PROCESS_STATE.STOPPED,
    [AskingTaskStatus.FAILED]: PROCESS_STATE.FAILED,
  }[data.status];

  if (
    data?.type === AskingTaskType.TEXT_TO_SQL &&
    processState === PROCESS_STATE.FINISHED &&
    data.candidates.length === 0
  ) {
    return PROCESS_STATE.NO_RESULT;
  }
  return processState;
};

export default function useAskProcessState() {
  const [currentState, setCurrentState] = useState<PROCESS_STATE>(
    PROCESS_STATE.IDLE,
  );

  const resetState = () => {
    setCurrentState(PROCESS_STATE.IDLE);
  };

  const matchedState = (askingTask: AskingTask) => {
    const targetState = convertAskingTaskToProcessState(askingTask);
    if (!targetState || targetState === currentState) return currentState;
    // Prevent unknown status, if not found we keep the current state
    if (ProcessStateMachine.canTransition(currentState, targetState)) {
      return targetState;
    } else {
      console.warn(
        `Invalid transition from ${currentState} to ${targetState}.`,
      );
      return currentState;
    }
  };

  const transitionTo = (targetState: PROCESS_STATE) => {
    setCurrentState(targetState);
  };

  const isFinished = () => {
    return currentState === PROCESS_STATE.FINISHED;
  };

  const isFailed = () => {
    return currentState === PROCESS_STATE.FAILED;
  };

  return {
    currentState,
    resetState,
    matchedState,
    transitionTo,
    isFinished,
    isFailed,
  };
}

export class ProcessStateMachine {
  private static transitions = {
    [PROCESS_STATE.IDLE]: {
      next: [PROCESS_STATE.UNDERSTANDING],
      prev: [],
    },
    [PROCESS_STATE.UNDERSTANDING]: {
      // probably skipped status if polling delay longer than AI processing time
      // so need to allow all possible statuses
      next: [
        PROCESS_STATE.SEARCHING,
        PROCESS_STATE.PLANNING,
        PROCESS_STATE.GENERATING,
      ],
      prev: [PROCESS_STATE.IDLE],
    },
    [PROCESS_STATE.SEARCHING]: {
      next: [PROCESS_STATE.PLANNING],
      prev: [PROCESS_STATE.UNDERSTANDING],
    },
    [PROCESS_STATE.PLANNING]: {
      next: [PROCESS_STATE.GENERATING],
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
    // Allow transition to FINISHED & FAILED state from any state
    return (
      from === PROCESS_STATE.IDLE ||
      to === PROCESS_STATE.FINISHED ||
      to === PROCESS_STATE.FAILED ||
      to === PROCESS_STATE.STOPPED ||
      this.transitions[from]?.next.includes(to)
    );
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
