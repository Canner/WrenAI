export interface ClientRuntimeScopeSelector {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
}

export interface RuntimeSelectorStateBootstrapData {
  currentWorkspace?: {
    id?: string | null;
  } | null;
  currentKnowledgeBase?: {
    id?: string | null;
  } | null;
  currentKbSnapshot?: {
    id?: string | null;
    deployHash?: string | null;
  } | null;
}

export interface RuntimeScopeWindowLike {
  location?: {
    search?: string;
  };
  sessionStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
  } | null;
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
  } | null;
  addEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  dispatchEvent?: (event: Event) => boolean;
}

export interface RuntimeScopeBootstrapCandidate {
  source: 'url' | 'stored' | 'server_default' | 'default';
  selector: ClientRuntimeScopeSelector;
}
