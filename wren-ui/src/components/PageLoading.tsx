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

export default function PageLoading(props: Props) {
  const { visible } = props;
  return (
    <Wrapper
      className={`align-center justify-center${visible ? ' isShow' : ''}`}
    >
      <div className="text-center">
        <Spin indicator={<LoadingOutlined style={{ fontSize: 36 }} spin />} />
        <div className="mt-2 geekblue-6">Loading...</div>
      </div>
    </Wrapper>
  );
}
