import { ReactNode, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

interface Props {
  text?: string;
  children?: ReactNode;
  multipleLine?: number;
  minHeight?: number;
}

const Wrapper = styled.div<{ multipleLine?: number }>`
  overflow: hidden;
  text-overflow: ellipsis;
  ${(props) =>
    props.multipleLine
      ? `
  display: -webkit-box;
  -webkit-line-clamp: ${props.multipleLine};
  -webkit-box-orient: vertical;
`
      : `
  white-space: nowrap;
`}
`;

export default function EllipsisWrapper(props: Props) {
  const { text, multipleLine, minHeight, children } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(undefined);
  const hasWidth = width !== undefined;

  // Auto setup client width itself
  useEffect(() => {
    if (ref.current && !hasWidth) {
      const cellWidth = ref.current.clientWidth;
      setWidth(cellWidth);
    }
  }, []);

  const renderContent = () => {
    if (!children) return text || '-';
    return children;
  };

  // Convert to string if React pass its children as array type to props
  const title = Array.isArray(text) ? text.join('') : text;

  return (
    <Wrapper
      ref={ref}
      title={title}
      multipleLine={multipleLine}
      style={{ width, minHeight }}
    >
      {hasWidth ? renderContent() : null}
    </Wrapper>
  );
}
