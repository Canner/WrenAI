import { createContext, useContext } from 'react';
import type { DeployStatusResult } from '@/hooks/useDeployStatusRest';

type ContextProps = DeployStatusResult;

export const DeployStatusContext = createContext<ContextProps>(
  {} as ContextProps,
);

export function useDeployStatusContext() {
  return useContext(DeployStatusContext);
}
