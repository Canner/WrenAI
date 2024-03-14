import { useEffect, useState } from 'react';
import { Typography, Row, Col } from 'antd';
import { cloneDeep, set } from 'lodash';
import EditableWrapper from '@/components/EditableWrapper';

export default function GenerateBasicMetadata(props) {
  const { dataSource, onChange } = props;
  const [data, setData] = useState(dataSource);

  useEffect(() => {
    onChange && onChange(data);
  }, [data]);

  const handleSave = (_, value) => {
    const [dataIndexKey] = Object.keys(value);

    const newData = cloneDeep(data);
    set(newData, dataIndexKey, value[dataIndexKey]);
    setData(newData);
  };

  return (
    <Row>
      <Col span={12}>
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Display name
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
      <Col span={12}>
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Description
          </Typography.Text>
          <EditableWrapper
            record={data}
            dataIndex="properties.description"
            handleSave={handleSave}
          >
            {data.properties?.description || '-'}
          </EditableWrapper>
        </div>
      </Col>
    </Row>
  );
}
