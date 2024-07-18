import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Space,
  Typography,
  Tag,
  Input,
  Popconfirm,
} from 'antd';
import styled from 'styled-components';
import {
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { DrawerAction } from '@/hooks/useDrawerAction';
import { makeIterable } from '@/utils/iteration';
import { getReferenceIcon, Reference } from './utils';
import { CreateRegeneratedThreadResponseInput } from '@/apollo/client/graphql/__types__';

type Props = DrawerAction & {
  references: Reference[];
  threadResponseId: number;
  onSaveCorrectionPrompt: (id: string, value: string) => void;
  onRemoveCorrectionPrompt: (id: string) => void;
  onResetAllCorrectionPrompts: () => void;
};

const StyledOriginal = styled.div`
  cursor: pointer;
  background-color: var(--gray-3);
  &:hover {
    background-color: var(--gray-4);
  }
`;

const ReviewTemplate = ({
  type,
  summary,
  referenceId,
  referenceNum,
  correctionPrompt,
  saveCorrectionPrompt,
  removeCorrectionPrompt,
}) => {
  const [isEdit, setIsEdit] = useState(false);
  const [isCollapse, setIsCollapse] = useState(false);
  const isRevise = !!correctionPrompt;

  const openEdit = async () => {
    setIsEdit(!isEdit);
  };

  const openDelete = () => {
    removeCorrectionPrompt(referenceId);
  };

  const handleEdit = (event) => {
    saveCorrectionPrompt(referenceId, event.target.value);
    setIsEdit(false);
  };

  return (
    <div>
      <StyledOriginal
        className="d-flex gray-6 py-1 px-3 rounded text-sm mb-2"
        onClick={() => setIsCollapse(true)}
      >
        <span className="gray-6 text-semi-bold flex-shrink-0 mr-1">
          <FileTextOutlined className="mr-1" />
          Reference:
        </span>
        <Typography.Text className="gray-6" ellipsis={!isCollapse}>
          {summary}
        </Typography.Text>
      </StyledOriginal>
      <div className="d-flex mb-4">
        <div className="lh-xs" style={{ paddingTop: 2 }}>
          <Tag className={clsx('ant-tag__reference', { isRevise })}>
            <span className="mr-1 lh-xs">{getReferenceIcon(type)}</span>
            {referenceNum}
          </Tag>
        </div>
        <div className="flex-grow-1">
          <Typography.Text className="gray-8">
            {isEdit ? (
              <Input.TextArea
                defaultValue={correctionPrompt}
                onPressEnter={handleEdit}
                onBlur={handleEdit}
                autoSize
                autoFocus
              />
            ) : (
              correctionPrompt
            )}
            {!isEdit && (
              <span className="gray-6 ml-2">
                <EditOutlined className="gray-6 mr-2" onClick={openEdit} />
                <Popconfirm
                  title="Are you sure?"
                  okText="Confirm"
                  okButtonProps={{ danger: true }}
                  onConfirm={openDelete}
                >
                  <DeleteOutlined className="red-5" />
                </Popconfirm>
              </span>
            )}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
};

const ReviewIterator = makeIterable(ReviewTemplate);

export default function ReviewDrawer(props: Props) {
  const {
    visible,
    threadResponseId,
    references,
    onClose,
    onSubmit,
    onSaveCorrectionPrompt,
    onRemoveCorrectionPrompt,
    onResetAllCorrectionPrompts,
  } = props;

  const changedReferences = useMemo(() => {
    return (references || []).filter(
      (reference) => !!reference.correctionPrompt,
    );
  }, [references]);

  useEffect(() => {
    if (changedReferences.length === 0) {
      onClose();
    }
  }, [changedReferences]);

  const submit = useCallback(async () => {
    try {
      const data: CreateRegeneratedThreadResponseInput = {
        responseId: threadResponseId,
        corrections: changedReferences.map((reference) => ({
          id: reference.referenceId,
          type: reference.type,
          reference: reference.summary,
          stepIndex: reference.stepIndex,
          correction: reference.correctionPrompt,
        })),
      };
      await onSubmit(data);
      onClose();
      onResetAllCorrectionPrompts();
    } catch (error) {
      console.error(error);
    }
  }, [changedReferences]);

  return (
    <Drawer
      visible={visible}
      title={`Review feedbacks (${changedReferences.length})`}
      width={520}
      closable
      destroyOnClose
      maskClosable={false}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={submit}>
            Submit
          </Button>
        </Space>
      }
    >
      <ReviewIterator
        data={changedReferences}
        saveCorrectionPrompt={onSaveCorrectionPrompt}
        removeCorrectionPrompt={onRemoveCorrectionPrompt}
      />
    </Drawer>
  );
}
