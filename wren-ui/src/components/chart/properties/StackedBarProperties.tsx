import { Form, Row, Col, Select } from 'antd';
import {
  PropertiesProps,
  getChartTypeOptions,
  getColumnOptions,
  ChartTypeProperty,
  AxisProperty,
} from './BasicProperties';

export default function StackedBarProperties(props: PropertiesProps) {
  const { columns } = props;
  const chartTypeOptions = getChartTypeOptions();
  const columnOptions = getColumnOptions(columns);
  return (
    <>
      <Row className="mb-2" gutter={16}>
        <Col span={12}>
          <ChartTypeProperty options={chartTypeOptions} />
        </Col>
        <Col span={12}>
          <Form.Item className="mb-0" label="Stack groups" name="color">
            <Select size="small" options={columnOptions} />
          </Form.Item>
        </Col>
      </Row>
      <AxisProperty options={columnOptions} />
    </>
  );
}
