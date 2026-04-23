import { useEffect } from 'react';
import { Empty, Typography } from 'antd';
import styled from 'styled-components';
import PreviewData from '@/components/dataPreview/PreviewData';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';
import type { ThreadResponse } from '@/types/home';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';

const { Text } = Typography;

const PreviewPanelShell = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 20px 0;
`;

const PreviewPanelBody = styled.div`
  flex: 1;
  min-height: 0;
`;

const PreviewPanelHint = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 12px;
`;

export default function ThreadWorkbenchPreviewPanel(props: {
  response?: ThreadResponse | null;
}) {
  const { response } = props;
  const messages = useThreadWorkbenchMessages();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response,
    fallbackSelector: runtimeScopeNavigation.selector,
  });
  const responseId = response?.id ?? null;
  const previewDataResult = useResponsePreviewData(
    responseId,
    responseRuntimeSelector,
  );

  useEffect(() => {
    if (responseId == null) {
      return;
    }
    void previewDataResult.ensureLoaded().catch(() => undefined);
  }, [previewDataResult, responseId]);

  return (
    <PreviewPanelShell>
      <PreviewPanelBody>
        {previewDataResult.data?.previewData ? (
          <PreviewData
            error={previewDataResult.error}
            loading={previewDataResult.loading}
            previewData={previewDataResult.data.previewData}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={messages.preview.emptyDescription}
                />
              ),
            }}
          />
        ) : (
          <PreviewData
            error={previewDataResult.error}
            loading={previewDataResult.loading}
            previewData={previewDataResult.data?.previewData}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={messages.preview.emptyDescription}
                />
              ),
            }}
          />
        )}
      </PreviewPanelBody>
      {previewDataResult.data?.previewData ? (
        <PreviewPanelHint>
          <Text className="text-base gray-6">
            {messages.preview.rowLimitHint}
          </Text>
        </PreviewPanelHint>
      ) : null}
    </PreviewPanelShell>
  );
}
