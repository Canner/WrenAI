import { createContext, useContext } from 'react';

const contextMap = new Map<string, React.Context<any>>();

export const STORE = {
  PROMPT_THREAD: 'PromptThread',
};

// Base store context hook
export default function useStoreContext() {
  const createStore = (id: string) => {
    if (contextMap.has(id)) return contextMap.get(id);
    const context = createContext(null);
    contextMap.set(id, context);
    return context;
  };

  const clearStore = (id: string) => {
    contextMap.delete(id);
  };

  const useStore = (id: string) => {
    const context = contextMap.get(id);
    if (!context) throw new Error(`Context not found for id: ${id}`);
    return useContext(context);
  };

  return {
    createStore,
    clearStore,
    useStore,
  };
}
