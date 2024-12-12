import { capitalize } from 'lodash';
import { Form, Row, Col, Select } from 'antd';
import { ChartType } from '@/apollo/client/graphql/__types__';

export const getChartTypeOptions = () => {
  return Object.entries(ChartType).map(([key, value]) => ({
    label: capitalize(value.replace('_', ' ')),
    value: key,
  }));
};

export const getColumnOptions = (columns: {name: string; type: string}[]) => {
  return (columns || []).map((column) => ({
    label: column.name,
    value: column.name,
  }));
};

export function ChartTypeProperty(props: {
  options: { label: string; value: string }[];
}) {
  const { options } = props;
  return (
    <Form.Item className="mb-0" label="Chart type" name="chartType">
      <Select size="small" options={options} />
    </Form.Item>
  );
}

export function AxisProperty(props: {
  options: { label: string; value: string }[];
}) {
  const { options } = props;
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item className="mb-0" label="X-axis" name="xAxis">
          <Select size="small" options={options} />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item className="mb-0" label="Y-axis" name="yAxis">
          <Select size="small" options={options} />
        </Form.Item>
      </Col>
    </Row>
  );
}

export interface PropertiesProps {
  columns: {name: string; type: string}[];
}

export default function BasicProperties(props: PropertiesProps) {
  const { columns } = props;
  const chartTypeOptions = getChartTypeOptions();
  const columnOptions = getColumnOptions(columns);
  return (
    <>
      <Row className="mb-2" gutter={16}>
        <Col span={12}>
          <ChartTypeProperty options={chartTypeOptions} />
        </Col>
        <Col span={12}></Col>
      </Row>
      <AxisProperty options={columnOptions} />
    </>
  );
}
