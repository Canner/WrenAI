import { useEffect, useState } from 'react';
import { Typography, Row, Col } from 'antd';
import { cloneDeep, set } from 'lodash';
import EditableWrapper from '@/components/EditableWrapper';

export default function EditBasicMetadata(props) {
  const { dataSource, onChange } = props;
  const [data, setData] = useState(dataSource);

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
      <Row>
        <Col span={12}>
          <div className="mb-6">
            <Typography.Text className="d-block gray-7 mb-2">
              Name
            </Typography.Text>
            <div>{data.referenceName}</div>
          </div>
        </Col>
        <Col span={12}>
          <div className="mb-6">
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
      <div className="mb-6">
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
