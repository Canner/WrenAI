import { Collapse } from 'antd';
import styled from 'styled-components';
import CaretRightOutlined from '@ant-design/icons/CaretRightOutlined';

const StyledCollapse = styled(Collapse)`
  .ant-collapse-item {
    > .ant-collapse-header {
      user-select: none;
      color: var(--gray-7);
      padding-left: 0;
      padding-right: 0;
      padding-top: 0;
      padding-bottom: 0;

      .ant-collapse-arrow {
        margin-right: 8px;
      }
    }
    > .ant-collapse-content .ant-collapse-content-box {
      color: var(--gray-7);
      padding: 4px 0 0 0;
    }
  }
`;

interface Props {
  message: string;
  className?: string;
}

export default function ErrorCollapse(props: Props) {
  const { message, className } = props;
  return (
    <StyledCollapse
      className={className}
      ghost
      expandIcon={({ isActive }) => (
        <CaretRightOutlined rotate={isActive ? 90 : 0} />
      )}
    >
      <Collapse.Panel key="1" header="Show error messages">
        <pre className="text-sm mb-0 pl-5" style={{ whiteSpace: 'pre-wrap' }}>
          {message}
        </pre>
      </Collapse.Panel>
    </StyledCollapse>
  );
}
