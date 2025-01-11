import { Spin } from 'antd';
import styled from 'styled-components';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';

const Wrapper = styled.div`
  position: absolute;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background-color: white;
  display: none;

  &.isShow {
    display: flex;
  }
`;

interface Props {
  visible?: boolean;
}

interface LoadingProps {
  children?: React.ReactNode | null;
  spinning?: boolean;
  loading?: boolean;
  tip?: string;
}

export const defaultIndicator = (
  <LoadingOutlined style={{ fontSize: 36 }} spin />
);

export default function PageLoading(props: Props) {
  const { visible } = props;
  return (
    <Wrapper
      className={`align-center justify-center${visible ? ' isShow' : ''}`}
    >
      <div className="text-center">
        <Spin indicator={defaultIndicator} />
        <div className="mt-2 geekblue-6">Loading...</div>
      </div>
    </Wrapper>
  );
}

export const FlexLoading = (props) => {
  const { height, tip } = props;
  return (
    <div
      className="d-flex align-center justify-center flex-column geekblue-6"
      style={{ height: height || '100%' }}
    >
      {defaultIndicator}
      {tip && <span className="mt-2">{tip}</span>}
    </div>
  );
};

export const Loading = ({
  children = null,
  spinning = false,
  loading = false,
  tip,
}: LoadingProps) => (
  <Spin indicator={defaultIndicator} spinning={spinning || loading} tip={tip}>
    {children}
  </Spin>
);

interface LoadingWrapperProps {
  loading: boolean;
  tip?: string;
  children: React.ReactElement;
}

export const LoadingWrapper = (props: LoadingWrapperProps) => {
  const { loading, tip, children } = props;
  if (loading) return <FlexLoading tip={tip} />;
  return children;
};
