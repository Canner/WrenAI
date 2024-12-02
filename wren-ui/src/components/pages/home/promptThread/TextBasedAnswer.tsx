import { useEffect } from 'react';
import { Alert, Button, Empty, Skeleton, Typography } from 'antd';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export default function TextBasedAnswer(
  props: Pick<
    AnswerResultProps,
    'threadResponse' | 'isLastThreadResponse' | 'onInitPreviewDone'
  >,
) {
  const { isLastThreadResponse, onInitPreviewDone, threadResponse } = props;
  const { error, id } = threadResponse;

  const [_, answerStreamTaskResult] = useTextBasedAnswerStreamTask();

  const answerStreamTask = answerStreamTaskResult.data;

  // TODO: num_rows_used_in_llm is 0 then don't show preview data with button
  const rowsUsed = 0;

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const onPreviewData = async () => {
    await previewData({
      variables: { where: { responseId: id } },
    });
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
    await nextTick();
    onInitPreviewDone();
  };

  useEffect(() => {
    if (isLastThreadResponse && rowsUsed > 0) {
      autoTriggerPreviewDataButton();
    }
  }, [isLastThreadResponse, rowsUsed]);

  // TODO: handle error, check error source comes from where
  if (error) {
    return (
      <Alert
        className="m-4"
        message={error.shortMessage}
        description={error.message}
        type="error"
        showIcon
      />
    );
  }

  return (
    <StyledSkeleton
      active
      loading={false}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 p-4 pr-6">
        <MarkdownBlock content={answerStreamTask} />
        {rowsUsed > 0 && (
          <div className="mt-6">
            <Button
              size="small"
              icon={
                <BinocularsIcon
                  style={{
                    paddingBottom: 2,
                    marginRight: 8,
                  }}
                />
              }
              loading={previewDataResult.loading}
              onClick={onPreviewData}
              data-ph-capture="true"
              data-ph-capture-attribute-name="cta_text-answer_preview_data"
            >
              View results
            </Button>

            <div className="mt-2 mb-3">
              <Text type="secondary" className="text-sm">
                Considering the limit of context window, we only use {rowsUsed}{' '}
                rows of results to generate the answer.
              </Text>
              <PreviewData
                error={previewDataResult.error}
                loading={previewDataResult.loading}
                previewData={previewDataResult?.data?.previewData}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Sorry, we couldn't find any records that match your search criteria."
                    />
                  ),
                }}
              />
            </div>
          </div>
        )}
      </div>
    </StyledSkeleton>
  );
}
