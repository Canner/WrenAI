import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Skeleton } from 'antd';
import styled from 'styled-components';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { buildKnowledgeModelingRouteParams } from '@/utils/knowledgeWorkbench';

const RedirectStage = styled.div`
  min-height: calc(100vh - 48px);
  padding: 32px;
  background: transparent;
`;

const RedirectCard = styled.div`
  max-width: 720px;
  border-radius: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  padding: 24px;
`;

export default function ModelingPage() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    void runtimeScopeNavigation.replace(
      Path.Knowledge,
      buildKnowledgeModelingRouteParams(router.query),
    );
  }, [router.isReady, router.query, runtimeScopeNavigation]);

  return (
    <RedirectStage>
      <RedirectCard>
        <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 4 }} />
      </RedirectCard>
    </RedirectStage>
  );
}
