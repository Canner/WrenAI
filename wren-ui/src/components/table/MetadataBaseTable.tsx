import { Space, Button } from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import React, { ReactElement, useMemo } from 'react';
import useModalAction from '@/hooks/useModalAction';
import { Props as BaseTableProps } from '@/components/table/BaseTable';

interface Props<MData> {
  dataSource: any[];
  metadataIndex?: Record<string, string>;
  onEditValue?: (value: any) => any;
  onSubmitRemote?: (value: any) => void;
  modalProps?: Partial<MData>;
  onCellRender?: (data: any) => ReactElement;
}

export const makeMetadataBaseTable =
  (BaseTable: React.FC<BaseTableProps>) =>
  <MData,>(ModalComponent?: React.FC<Partial<MData>>) => {
    const isEditable = !!ModalComponent;

    const MetadataBaseTable = (props: Props<MData>) => {
      const {
        dataSource,
        onEditValue = (value) => value,
        onSubmitRemote,
        modalProps,
        onCellRender,
      } = props;

      const modalComponent = useModalAction();

      const actionColumns = useMemo(
        () =>
          isEditable
            ? [
                {
                  key: 'action',
                  width: 64,
                  render: (record) => {
                    return (
                      <Space className="d-flex justify-end">
                        <Button
                          type="text"
                          className="px-2"
                          onClick={() =>
                            modalComponent.openModal(onEditValue(record))
                          }
                        >
                          <EditOutlined />
                        </Button>
                      </Space>
                    );
                  },
                },
              ]
            : [],
        [dataSource]
      );

      const submitModal = async (values: any) => {
        onSubmitRemote && (await onSubmitRemote(values));
      };

      return (
        <>
          <BaseTable
            dataSource={dataSource}
            actionColumns={actionColumns}
            components={onCellRender ? { body: { cell: onCellRender } } : null}
          />
          {isEditable && (
            <ModalComponent
              {...modalComponent.state}
              {...modalProps}
              onClose={modalComponent.closeModal}
              onSubmit={submitModal}
            />
          )}
        </>
      );
    };

    return MetadataBaseTable;
  };
