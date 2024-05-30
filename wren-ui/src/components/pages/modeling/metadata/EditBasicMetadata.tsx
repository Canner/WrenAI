import { useEffect, useState } from 'react';
import { Typography, Row, Col } from 'antd';
import { cloneDeep, set } from 'lodash';
import { NODE_TYPE } from '@/utils/enum';
import EditableWrapper from '@/components/EditableWrapper';

interface Props {
  dataSource: any;
  onChange?: (value: any) => void;
  nodeType: NODE_TYPE;
  rules?: Record<string, any[]>;
}

export default function EditBasicMetadata(props: Props) {
  const { dataSource, onChange, nodeType, rules } = props;
  const [data, setData] = useState(dataSource);

  const isModel = nodeType === NODE_TYPE.MODEL;
  const isView = nodeType === NODE_TYPE.VIEW;

  useEffect(() => {
    // bind changeable metadata values
    onChange &&
      onChange({
        displayName: data.displayName,
        description: data.description,
      });
  }, [data]);

  const handleSave = (_, value) => {
    const [dataIndexKey] = Object.keys(value);

    const newData = cloneDeep(data);
    set(newData, dataIndexKey, value[dataIndexKey]);
    setData(newData);
  };

  return (
    <>
      {isModel && (
        <Row>
          <Col span={12}>
            <div className="mb-6" data-testid="edit-metadata__name">
              <Typography.Text className="d-block gray-7 mb-2">
                Name
              </Typography.Text>
              <div>{data.referenceName}</div>
            </div>
          </Col>
          <Col span={12} data-testid="edit-metadata__alias">
            <div className="mb-6" data-testid="metadata__name">
              <Typography.Text className="d-block gray-7 mb-2">
                Alias
              </Typography.Text>
              <EditableWrapper
                record={data}
                dataIndex="displayName"
                handleSave={handleSave}
              >
                {data.displayName || '-'}
              </EditableWrapper>
            </div>
          </Col>
        </Row>
      )}

      {isView && (
        <div className="mb-6" data-testid="edit-metadata__name">
          <Typography.Text className="d-block gray-7 mb-2">
            Name
          </Typography.Text>
          <EditableWrapper
            record={data}
            dataIndex="displayName"
            handleSave={handleSave}
            rules={rules?.displayName}
          >
            {data.displayName || '-'}
          </EditableWrapper>
        </div>
      )}

      <div className="mb-6" data-testid="edit-metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">
          Description
        </Typography.Text>
        <EditableWrapper
          record={data}
          dataIndex="description"
          handleSave={handleSave}
        >
          {data.description || '-'}
        </EditableWrapper>
      </div>
    </>
  );
}
