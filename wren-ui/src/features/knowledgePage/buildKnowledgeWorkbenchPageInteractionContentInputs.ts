import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchContentData,
  KnowledgeWorkbenchControllerInteractionInputs,
} from './knowledgeWorkbenchPageInteractionInputTypes';

export function buildKnowledgeWorkbenchPageInteractionContentInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  contentData: KnowledgeWorkbenchContentData<TKnowledgeBase, TConnector>,
): Pick<
  KnowledgeWorkbenchControllerInteractionInputs<TKnowledgeBase, TConnector>,
  | 'assets'
  | 'connectors'
  | 'demoDatabaseOptions'
  | 'demoTableOptions'
  | 'diagramData'
  | 'diagramLoading'
  | 'isDemoSource'
  | 'overviewPreviewAsset'
  | 'routeRuntimeSyncing'
  | 'selectedConnectorId'
  | 'selectedDemoKnowledge'
  | 'selectedDemoTable'
  | 'setSelectedConnectorId'
  | 'setSelectedDemoTable'
> {
  const {
    assets,
    connectors,
    demoDatabaseOptions,
    demoTableOptions,
    diagramData,
    diagramLoading,
    isDemoSource,
    overviewPreviewAsset,
    routeRuntimeSyncing,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    setSelectedConnectorId,
    setSelectedDemoTable,
  } = contentData;

  return {
    assets,
    connectors,
    demoDatabaseOptions,
    demoTableOptions,
    diagramData,
    diagramLoading,
    isDemoSource,
    overviewPreviewAsset,
    routeRuntimeSyncing,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    setSelectedConnectorId,
    setSelectedDemoTable,
  };
}

export default buildKnowledgeWorkbenchPageInteractionContentInputs;
