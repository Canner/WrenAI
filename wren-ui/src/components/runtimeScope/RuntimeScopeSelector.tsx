import { useRouter } from 'next/router';
import { useQuery } from '@apollo/client';
import { Select, Space, Typography } from 'antd';
import styled from 'styled-components';
import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
} from '@/apollo/client/runtimeScope';
import { RUNTIME_SELECTOR_STATE } from '@/apollo/client/graphql/runtimeScope';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import { Path } from '@/utils/enum';

const { Text } = Typography;

const SelectorGroup = styled(Space)`
  .runtime-scope-select {
    min-width: 168px;
  }

  .runtime-scope-workspace {
    max-width: 180px;
  }
`;

interface RuntimeSelectorWorkspace {
  id: string;
  slug: string;
  name: string;
}

interface RuntimeSelectorKnowledgeBase {
  id: string;
  slug: string;
  name: string;
  defaultKbSnapshotId?: string | null;
}

interface RuntimeSelectorKBSnapshot {
  id: string;
  snapshotKey: string;
  displayName: string;
  deployHash: string;
  status: string;
}

interface RuntimeSelectorStateData {
  runtimeSelectorState: {
    currentWorkspace: RuntimeSelectorWorkspace | null;
    currentKnowledgeBase: RuntimeSelectorKnowledgeBase | null;
    currentKbSnapshot: RuntimeSelectorKBSnapshot | null;
    knowledgeBases: RuntimeSelectorKnowledgeBase[];
    kbSnapshots: RuntimeSelectorKBSnapshot[];
  } | null;
}

export default function RuntimeScopeSelector() {
  const router = useRouter();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const { data, loading } = useQuery<RuntimeSelectorStateData>(
    RUNTIME_SELECTOR_STATE,
    {
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'cache-first',
    },
  );

  const selectorState = data?.runtimeSelectorState;
  const currentWorkspace = selectorState?.currentWorkspace;
  const currentKnowledgeBase = selectorState?.currentKnowledgeBase;
  const currentKbSnapshot = selectorState?.currentKbSnapshot;
  const onThreadPage = router.pathname === Path.Thread;
  const baseParams = omitRuntimeScopeQuery(router.query);

  if (!selectorState || !currentWorkspace) {
    return null;
  }

  const navigateWithSelector = (nextSelector: {
    workspaceId: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
  }) => {
    const nextUrl = buildRuntimeScopeUrl(
      router.pathname,
      baseParams,
      nextSelector,
    );
    runtimeScopeTransition.transitionTo(nextUrl);
  };

  return (
    <SelectorGroup size={[8, 0]}>
      <Text
        className="gray-1 runtime-scope-workspace"
        ellipsis={{ tooltip: currentWorkspace.name }}
      >
        {currentWorkspace.name}
      </Text>
      <Select
        className="runtime-scope-select"
        size="small"
        loading={loading}
        value={currentKnowledgeBase?.id}
        disabled={
          loading ||
          runtimeScopeTransition.transitioning ||
          onThreadPage ||
          !selectorState.knowledgeBases.length
        }
        options={selectorState.knowledgeBases.map((knowledgeBase) => ({
          label: knowledgeBase.name,
          value: knowledgeBase.id,
        }))}
        placeholder="Knowledge Base"
        dropdownMatchSelectWidth={false}
        onChange={(knowledgeBaseId: string) => {
          if (
            !currentWorkspace?.id ||
            !knowledgeBaseId ||
            knowledgeBaseId === currentKnowledgeBase?.id
          ) {
            return;
          }

          navigateWithSelector({
            workspaceId: currentWorkspace.id,
            knowledgeBaseId,
          });
        }}
      />
      <Select
        className="runtime-scope-select"
        size="small"
        loading={loading}
        value={currentKbSnapshot?.id}
        disabled={
          loading ||
          runtimeScopeTransition.transitioning ||
          onThreadPage ||
          !currentWorkspace?.id ||
          !currentKnowledgeBase?.id ||
          !selectorState.kbSnapshots.length
        }
        options={selectorState.kbSnapshots.map((kbSnapshot) => ({
          label: kbSnapshot.displayName,
          value: kbSnapshot.id,
        }))}
        placeholder="Snapshot"
        dropdownMatchSelectWidth={false}
        onChange={(kbSnapshotId: string) => {
          if (
            !currentWorkspace?.id ||
            !currentKnowledgeBase?.id ||
            !kbSnapshotId ||
            kbSnapshotId === currentKbSnapshot?.id
          ) {
            return;
          }

          navigateWithSelector({
            workspaceId: currentWorkspace.id,
            knowledgeBaseId: currentKnowledgeBase.id,
            kbSnapshotId,
          });
        }}
      />
    </SelectorGroup>
  );
}
