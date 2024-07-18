import clsx from 'clsx';
import { groupBy } from 'lodash';
import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Tag, Typography, Button, Input, Alert } from 'antd';
import {
  EditOutlined,
  CloseCircleFilled,
  ReloadOutlined,
  InfoCircleFilled,
} from '@ant-design/icons';
import { QuoteIcon } from '@/utils/icons';
import { makeIterable } from '@/utils/iteration';
import {
  REFERENCE_ORDERS,
  Reference,
  getReferenceIcon,
  getReferenceName,
} from './utils';
import { ERROR_CODES } from '@/utils/errorHandler';

const StyledReferenceSideFloat = styled.div`
  position: relative;

  .referenceSideFloat-title {
    position: absolute;
    top: -14px;
    padding: 0 4px;
  }
`;

const StyledAlert = styled(Alert)`
  padding: 8px 12px 12px;
  .ant-alert-icon {
    font-size: 14px;
    margin-right: 8px;
    margin-top: 4px;
  }
  .ant-alert-message {
    font-size: 14px;
    line-height: 14px;
    margin-top: 4px;
    margin-bottom: 8px;
  }
  .ant-alert-description {
    font-size: 12px;
    line-height: 14px;
    color: var(--gray-8);
  }
`;

interface Props {
  references: Reference[];
  error?: Record<string, string>;
  onSaveCorrectionPrompt: (id: string, value: string) => void;
  onTriggerExplanation: () => void;
}

const COLLAPSE_LIMIT = 3;

const ReferenceSummaryTemplate = ({
  summary,
  type,
  referenceNum,
  correctionPrompt,
}) => {
  const isRevise = !!correctionPrompt;
  return (
    <div className="d-flex align-center my-1">
      <Tag className={clsx('ant-tag__reference', { isRevise })}>
        <span className="mr-1 lh-xs">{getReferenceIcon(type)}</span>
        {referenceNum}
      </Tag>
      <Typography.Text className="gray-8" ellipsis>
        {summary}
      </Typography.Text>
    </div>
  );
};

const GroupReferenceTemplate = ({
  name,
  type,
  data,
  index,
  saveCorrectionPrompt,
}) => {
  if (!data.length) return null;
  return (
    <div className={clsx({ 'pt-3': index > 0 })}>
      <Typography.Text className="d-flex align-center geekblue-5 text-medium mb-2 py-1 border-b border-gray-4">
        <span className="d-inline-flex mr-1">{getReferenceIcon(type)}</span>{' '}
        {name}
      </Typography.Text>
      <ReferenceIterator
        data={data}
        saveCorrectionPrompt={saveCorrectionPrompt}
      />
    </div>
  );
};

const ReferenceTemplate = ({
  type,
  summary,
  referenceId,
  referenceNum,
  correctionPrompt,
  saveCorrectionPrompt,
}) => {
  const [isEdit, setIsEdit] = useState(false);
  const [value, setValue] = useState(correctionPrompt);
  const isRevise = !!correctionPrompt;

  const openEdit = () => {
    setIsEdit(!isEdit);
  };

  const handleEdit = () => {
    saveCorrectionPrompt(referenceId, value);
    setIsEdit(false);
    setValue('');
  };

  return (
    <div className="d-flex my-1">
      <div className="lh-xs" style={{ paddingTop: 2 }}>
        <Tag className={clsx('ant-tag__reference', { isRevise })}>
          <span className="mr-1 lh-xs">{getReferenceIcon(type)}</span>
          {referenceNum}
        </Tag>
      </div>
      <div className="flex-grow-1">
        <Typography.Text className="gray-8">
          {summary}
          <span className="gray-6 ml-2">
            {isRevise ? (
              '(feedback suggested)'
            ) : (
              <EditOutlined className="gray-6 " onClick={openEdit} />
            )}
          </span>
        </Typography.Text>
        {isEdit && (
          <div className="py-1 px-2 bg-gray-3 rounded my-2">
            <Input.Group className="d-flex" compact>
              <Input
                className="text-sm"
                size="small"
                placeholder="Add a prompt for feedback..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onPressEnter={handleEdit}
              />
              <Button
                className="text-sm"
                size="small"
                type="primary"
                onClick={handleEdit}
              >
                Save
              </Button>
            </Input.Group>
          </div>
        )}
      </div>
    </div>
  );
};

const ReferenceSummaryIterator = makeIterable(ReferenceSummaryTemplate);
const GroupReferenceIterator = makeIterable(GroupReferenceTemplate);
const ReferenceIterator = makeIterable(ReferenceTemplate);

const References = (props: Props) => {
  const { references, onSaveCorrectionPrompt } = props;
  const referencesByGroup = groupBy(references, 'type');
  const resources = REFERENCE_ORDERS.map((type) => ({
    type,
    name: getReferenceName(type),
    data: referencesByGroup[type] || [],
  }));

  return (
    <div
      className="pr-4 -mr-2"
      style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}
    >
      <GroupReferenceIterator
        data={resources}
        saveCorrectionPrompt={onSaveCorrectionPrompt}
      />
    </div>
  );
};

export default function ReferenceSideFloat(props: Props) {
  const { references, error, onTriggerExplanation } = props;
  const [collapse, setCollapse] = useState(false);

  const referencesSummary = useMemo(
    () => references.slice(0, COLLAPSE_LIMIT),
    [collapse, references],
  );

  const handleCollapse = () => {
    setCollapse(!collapse);
  };

  if (error) {
    // If the thread response was created before the release of the Feedback Loop Feature,
    // the explanation will be migrated with an error code OLD_VERSION.
    // In this case, users will need to manually trigger the explanation.
    const isOldVersion = error.code === ERROR_CODES.OLD_VERSION;
    const shortMessage = isOldVersion ? 'Show References' : error.shortMessage;
    const icon = isOldVersion ? <InfoCircleFilled /> : <CloseCircleFilled />;
    const type = isOldVersion ? 'info' : 'error';
    const buttonText = isOldVersion ? 'Show' : 'Retry';

    return (
      <StyledAlert
        message={shortMessage}
        description={error.message}
        type={type}
        showIcon
        icon={icon}
        action={
          <Button
            className="text-sm"
            size="small"
            danger={!isOldVersion}
            icon={<ReloadOutlined className="-mr-1" />}
            onClick={onTriggerExplanation}
          >
            {buttonText}
          </Button>
        }
      />
    );
  } else if (references.length === 0) return null;
  return (
    <StyledReferenceSideFloat className="border border-gray-4 rounded p-4">
      <div className="referenceSideFloat-title text-md text-medium bg-gray-1 -ml-2">
        <QuoteIcon /> References
      </div>
      {collapse ? (
        <References {...props} />
      ) : (
        <>
          <ReferenceSummaryIterator data={referencesSummary} />
          <Button
            type="text"
            size="small"
            className="gray-6 -mb-2"
            onClick={handleCollapse}
          >
            - Show all ({references.length})
          </Button>
        </>
      )}
    </StyledReferenceSideFloat>
  );
}
