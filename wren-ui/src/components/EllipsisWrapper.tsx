import {
  Children,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styled from 'styled-components';

interface Props {
  text?: string;
  children?: ReactNode;
  multipleLine?: number;
  minHeight?: number;
  showMoreCount?: boolean;
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
  const { text, multipleLine, minHeight, children, showMoreCount } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | 'auto' | undefined>(undefined);
  const hasWidth = width !== undefined;
  const childrenArray = useMemo(() => Children.toArray(children), [children]);
  // Stage for counting the children that will be shown
  const [stage, setStage] = useState<ReactNode[]>([]);

  const isStageEnd = useRef(false);
  const calculateStageShow = () => {
    if (isStageEnd.current) return;
    if (typeof width !== 'number') return;
    const remainSpace = 60; // remain space for showing more tip
    const stageWidth = stageRef.current?.clientWidth;
    if (stageWidth === undefined) return;
    const canPrintNext = stageWidth < width - remainSpace;

    if (canPrintNext) {
      setStage((previousStage) => {
        if (childrenArray.length <= previousStage.length) {
          return previousStage;
        }
        return [...previousStage, childrenArray[previousStage.length]];
      });
    } else {
      setStage((previousStage) =>
        previousStage.slice(0, previousStage.length - 1),
      );
      isStageEnd.current = true;
    }
  };

  // Auto setup client width itself
  useEffect(() => {
    if (ref.current && !hasWidth) {
      const cellWidth = ref.current.clientWidth;
      cellWidth === 0 ? setWidth('auto') : setWidth(cellWidth);
    }

    // Reset state when unmount
    return () => {
      isStageEnd.current = false;
      setStage([]);
      setWidth(undefined);
    };
  }, []);

  // Only work when showMoreCount is provided
  useEffect(() => {
    if (!showMoreCount) return;
    // Run only once when showMoreCount is true
    if (stage.length === 0) {
      setStage(childrenArray.slice(0, 1));
      return;
    }
    calculateStageShow();
  }, [showMoreCount, stage, childrenArray, width]);

  const renderContent = () => {
    if (!children) return text || '-';

    // Turn another template if showMoreCount is provided
    if (showMoreCount) {
      const moreCount = childrenArray.length - stage.length;
      return (
        <span className="d-inline-block" ref={stageRef}>
          {stage}
          {moreCount > 0 && <span className="gray-7">...{moreCount} more</span>}
        </span>
      );
    }

    return children;
  };

  return (
    <Wrapper
      ref={ref}
      title={text}
      multipleLine={multipleLine}
      style={{ width, minHeight }}
    >
      {hasWidth ? renderContent() : null}
    </Wrapper>
  );
}
