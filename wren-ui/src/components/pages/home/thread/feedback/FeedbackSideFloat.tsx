import clsx from 'clsx';
import { useMemo } from 'react';
import styled from 'styled-components';
import { Button, Popconfirm } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { Reference } from './utils';

const StyledFeedbackSideFloat = styled.div`
  position: relative;

  .feedbackSideFloat-title {
    position: absolute;
    top: -14px;
    padding: 0 4px;
  }
`;

interface Props {
  className?: string;
  references: Reference[];
  onOpenReviewDrawer: () => void;
  onResetAllCorrectionPrompts: () => void;
}

export default function FeedbackSideFloat(props: Props) {
  const {
    className,
    references,
    onOpenReviewDrawer,
    onResetAllCorrectionPrompts,
  } = props;

  const changedReferences = useMemo(() => {
    return (references || []).filter((item) => !!item.correctionPrompt);
  }, [references]);

  if (changedReferences.length === 0) return null;
  return (
    <StyledFeedbackSideFloat
      className={clsx('border border-gray-4 rounded p-4', className)}
    >
      <div className="feedbackSideFloat-title text-md text-medium bg-gray-1 citrus-6 -ml-2">
        <FileTextOutlined /> Pending feedbacks
      </div>
      <div className="d-flex mt-2">
        <Button
          className="text-sm"
          type="primary"
          size="small"
          onClick={onOpenReviewDrawer}
        >
          Review feedbacks ({changedReferences.length})
        </Button>
        <Popconfirm
          title="Are you sure?"
          okText="Confirm"
          okButtonProps={{ danger: true }}
          onConfirm={onResetAllCorrectionPrompts}
        >
          <Button className="text-sm gray-6 ml-2" type="text" size="small">
            Reset all
          </Button>
        </Popconfirm>
      </div>
    </StyledFeedbackSideFloat>
  );
}
