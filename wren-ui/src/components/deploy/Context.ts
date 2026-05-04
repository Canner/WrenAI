import { createContext, useContext } from 'react';
import { DeployStatusQueryHookResult } from '@/apollo/client/graphql/deploy.generated';

type ContextProps = DeployStatusQueryHookResult;

export const DeployStatusContext = createContext<ContextProps>(
  {} as ContextProps,
);

export function useDeployStatusContext() {
  return useContext(DeployStatusContext);
}
