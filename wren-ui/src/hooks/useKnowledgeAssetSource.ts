import { useEffect, useMemo, useState } from 'react';
import {
  REFERENCE_DEMO_KNOWLEDGE_BASES,
  type ReferenceDemoKnowledge,
} from '@/utils/referenceDemoKnowledge';

type SourceOption = {
  key: string;
  category: 'demo' | 'connector';
};

type ConnectorInput = {
  id: string;
  displayName: string;
  type: string;
};

export const resolveSelectedDemoKnowledge = (sourceType: string) => {
  if (sourceType === 'demo_hr') {
    return (
      REFERENCE_DEMO_KNOWLEDGE_BASES.find((item) => item.id === 'demo-kb-hr') ||
      REFERENCE_DEMO_KNOWLEDGE_BASES[1]
    );
  }

  if (sourceType === 'demo_ecommerce') {
    return (
      REFERENCE_DEMO_KNOWLEDGE_BASES.find(
        (item) => item.id === 'demo-kb-ecommerce',
      ) || REFERENCE_DEMO_KNOWLEDGE_BASES[0]
    );
  }

  return null;
};

export default function useKnowledgeAssetSource({
  sourceOptions,
  connectors,
  initialSourceType = 'demo_ecommerce',
}: {
  sourceOptions: SourceOption[];
  connectors: ConnectorInput[];
  initialSourceType?: string;
}) {
  const [selectedSourceType, setSelectedSourceType] =
    useState(initialSourceType);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>();
  const [selectedDemoTable, setSelectedDemoTable] = useState<string>();

  const selectedSourceOption = useMemo(
    () =>
      sourceOptions.find((option) => option.key === selectedSourceType) ||
      sourceOptions[0],
    [selectedSourceType, sourceOptions],
  );
  const selectedDemoKnowledge = useMemo<ReferenceDemoKnowledge | null>(
    () => resolveSelectedDemoKnowledge(selectedSourceType),
    [selectedSourceType],
  );
  const isDemoSource = selectedSourceOption.category === 'demo';

  useEffect(() => {
    if (!selectedDemoKnowledge) {
      setSelectedDemoTable(undefined);
      return;
    }

    setSelectedDemoTable(`${selectedDemoKnowledge.id}::theme-view`);
  }, [selectedDemoKnowledge]);

  useEffect(() => {
    if (!selectedConnectorId && connectors.length > 0) {
      setSelectedConnectorId(connectors[0].id);
    }
  }, [connectors, selectedConnectorId]);

  const demoDatabaseOptions = useMemo(
    () =>
      selectedDemoKnowledge
        ? [
            {
              label: `${selectedDemoKnowledge.name} 系统样例`,
              value: selectedDemoKnowledge.id,
            },
          ]
        : [],
    [selectedDemoKnowledge],
  );
  const demoTableOptions = useMemo(
    () =>
      selectedDemoKnowledge
        ? [
            {
              label: selectedDemoKnowledge.assetName,
              value: `${selectedDemoKnowledge.id}::theme-view`,
            },
            {
              label: `${selectedDemoKnowledge.assetName} / 核心字段`,
              value: `${selectedDemoKnowledge.id}::core-fields`,
            },
          ]
        : [],
    [selectedDemoKnowledge],
  );

  const canContinueAssetWizard = isDemoSource
    ? Boolean(selectedDemoTable)
    : Boolean(selectedConnectorId);

  return {
    selectedSourceType,
    setSelectedSourceType,
    selectedConnectorId,
    setSelectedConnectorId,
    selectedDemoTable,
    setSelectedDemoTable,
    selectedSourceOption,
    selectedDemoKnowledge,
    isDemoSource,
    demoDatabaseOptions,
    demoTableOptions,
    canContinueAssetWizard,
  };
}
