import clsx from 'clsx';
import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Tag, Typography, Button, Input } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { QuoteIcon } from '@/utils/icons';
import { makeIterable } from '@/utils/iteration';
import { ReferenceTypes, getReferenceIcon } from './utils';

const StyledReferenceSideFloat = styled.div`
  position: relative;
  width: 330px;

  .referenceSideFloat-title {
    position: absolute;
    top: -14px;
    padding: 0 4px;
  }
`;

interface Props {
  references: any[];
  onSaveCorrectionPrompt?: (id: string, value: string) => void;
}

const COLLAPSE_LIMIT = 3;

const ReferenceSummaryTemplate = ({
  title,
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
        {title}
        {isRevise && <span className="gray-6 ml-2">(revised)</span>}
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
  id,
  title,
  type,
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
    saveCorrectionPrompt(id, value);
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
          {title}
          <span className="gray-6 ml-2">
            {isRevise ? (
              '(revised)'
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
                placeholder="Add a prompt for adjustment..."
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

  const fieldReferences = references.filter(
    (ref) => ref.type === ReferenceTypes.FIELD,
  );
  const queryFromReferences = references.filter(
    (ref) => ref.type === ReferenceTypes.QUERY_FROM,
  );
  const filterReferences = references.filter(
    (ref) => ref.type === ReferenceTypes.FILTER,
  );
  const sortingReferences = references.filter(
    (ref) => ref.type === ReferenceTypes.SORTING,
  );
  const groupByReferences = references.filter(
    (ref) => ref.type === ReferenceTypes.GROUP_BY,
  );

  const resources = [
    { name: 'Fields', type: ReferenceTypes.FIELD, data: fieldReferences },
    {
      name: 'Query from',
      type: ReferenceTypes.QUERY_FROM,
      data: queryFromReferences,
    },
    { name: 'Filter', type: ReferenceTypes.FILTER, data: filterReferences },
    { name: 'Sorting', type: ReferenceTypes.SORTING, data: sortingReferences },
    {
      name: 'Group by',
      type: ReferenceTypes.GROUP_BY,
      data: groupByReferences,
    },
  ];

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
  const { references } = props;
  const [collapse, setCollapse] = useState(false);

  const referencesSummary = useMemo(
    () => references.slice(0, COLLAPSE_LIMIT),
    [collapse, references],
  );

  const handleCollapse = () => {
    setCollapse(!collapse);
  };

  if (references.length === 0) return null;
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
