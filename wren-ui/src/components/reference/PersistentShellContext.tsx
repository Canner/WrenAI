import { createContext, useContext } from 'react';

type PersistentShellContextValue = {
  embedded: boolean;
  refetchHistory: () => Promise<unknown> | void;
};

const PersistentShellContext = createContext<PersistentShellContextValue>({
  embedded: false,
  refetchHistory: () => undefined,
});

export const PersistentShellProvider = PersistentShellContext.Provider;

export const usePersistentShellContext = () =>
  useContext(PersistentShellContext);

export const usePersistentShellEmbedded = () =>
  usePersistentShellContext().embedded;

export const usePersistentShellHistoryRefetch = () =>
  usePersistentShellContext().refetchHistory;
