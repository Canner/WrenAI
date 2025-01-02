import { Form, Row, Col, Select } from 'antd';
import {
  PropertiesProps,
  getColumnOptions,
  getChartTypeOptions,
  ChartTypeProperty,
} from './BasicProperties';

export default function DonutProperties(props: PropertiesProps) {
  const { columns, titleMap } = props;
  const chartTypeOptions = getChartTypeOptions();
  const columnOptions = getColumnOptions(columns, titleMap);
  return (
    <>
      <Row gutter={16} className="mb-2">
        <Col span={12}>
          <ChartTypeProperty options={chartTypeOptions} />
        </Col>
        <Col span={12}>
          <Form.Item className="mb-0" label="Category" name="color">
            <Select
              size="small"
              options={columnOptions}
              placeholder="Select category"
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item className="mb-0" label="Value" name="theta">
            <Select
              size="small"
              options={columnOptions}
              placeholder="Select value"
            />
          </Form.Item>
        </Col>
        <Col span={12}></Col>
      </Row>
    </>
  );
}
