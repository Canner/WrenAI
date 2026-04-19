import { Skeleton } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import { createCompatibilityRuntimeRedirectPage } from '@/utils/compatibilityRoutes';
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

export default createCompatibilityRuntimeRedirectPage({
  legacyRoute: Path.Modeling,
  canonicalRoute: Path.Knowledge,
  buildQuery: buildKnowledgeModelingRouteParams,
  fallback: (
    <RedirectStage>
      <RedirectCard>
        <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 4 }} />
      </RedirectCard>
    </RedirectStage>
  ),
});
