import { Popover, PopoverProps, Row, Col, Typography } from 'antd';

type Props = PopoverProps;

export default function CustomPopover(props: Props) {
  const { children } = props;

  return (
    <Popover {...props} mouseLeaveDelay={0} overlayStyle={{ maxWidth: 520 }}>
      {children}
    </Popover>
  );
}

const CustomPopoverCol = (props: {
  title: string;
  children: React.ReactNode;
  code?: boolean;
  span?: number;
  marginBottom?: number;
}) => {
  const { title, children, code, span = 24, marginBottom = 8 } = props;
  return (
    <Col span={span}>
      <div className="gray-7 mb-0">{title}</div>
      <div style={{ marginBottom }}>
        <Typography.Text code={code}>{children}</Typography.Text>
      </div>
    </Col>
  );
};

CustomPopover.Row = Row;
CustomPopover.Col = CustomPopoverCol;
