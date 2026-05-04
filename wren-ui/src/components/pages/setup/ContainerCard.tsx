import styled from 'styled-components';
import { Card, Steps } from 'antd';

const Container = styled.div<{ maxWidth?: number }>`
  max-width: ${(props) => props.maxWidth || 1200}px;
  margin: 68px auto;
`;

interface Props {
  step: number;
  children: React.ReactNode;
  maxWidth?: number;
}

export default function ContainerCard(props: Props) {
  const { step, maxWidth } = props;

  return (
    <Container maxWidth={maxWidth}>
      <Card>
        <Steps current={step} className="mb-12">
          <Steps.Step title="Connect" />
          <Steps.Step title="Select Tables" />
          <Steps.Step title="Define Relationships" />
        </Steps>
        <div className="px-12 pb-6">{props.children}</div>
      </Card>
    </Container>
  );
}
