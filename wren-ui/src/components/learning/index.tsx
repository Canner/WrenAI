import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import { IterableComponent, makeIterable } from '@/utils/iteration';
import LearningGuide from '@/components/learning/guide';
import { LEARNING } from './guide/utils';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';

const Progress = styled.div<{ total: number; current: number }>`
  display: block;
  border-radius: 999px;
  height: 6px;
  width: 100%;
  background-color: var(--gray-4);

  &::before {
    content: '';
    display: block;
    border-radius: 999px;
    width: ${({ total, current }) => `${(current / total) * 100}%`};
    height: 100%;
    background: linear-gradient(to left, #75eaff, #6150e0);
  }
`;

const CollapseBlock = styled.div`
  transition: height 0.3s;
  overflow: hidden;
`;

const PlayIcon = styled.div`
  position: relative;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--gray-5);
  &::before {
    content: '';
    display: block;
    position: absolute;
    top: 50%;
    left: 50%;
    margin-top: -4px;
    margin-left: -2px;
    border-top: 4px solid transparent;
    border-left: 6px solid var(--gray-8);
    border-bottom: 4px solid transparent;
  }
`;

const List = styled.div<{ finished: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-size: 12px;
  color: ${({ finished }) => (finished ? 'var(--gray-6)' : 'var(--gray-8)')};
  text-decoration: ${({ finished }) => (finished ? 'line-through' : 'none')};
  padding: 2px 16px;

  &:hover {
    transition: background-color 0.3s;
    background-color: var(--gray-4);
    color: ${({ finished }) => (finished ? 'var(--gray-6)' : 'var(--gray-8)')};
  }
`;

const ListTemplate = (props: IterableComponent<LearningConfig>) => {
  const { title, onClick, href, finished } = props;
  const as = href ? 'a' : 'div';
  const hrefAttrs = href
    ? ({ href, target: '_blank', rel: 'noopener noreferrer' } as any)
    : {};
  return (
    <List
      className="select-none"
      finished={finished}
      onClick={onClick}
      as={as}
      {...hrefAttrs}
    >
      {title}
      <PlayIcon />
    </List>
  );
};

const ListIterator = makeIterable(ListTemplate);

interface LearningConfig {
  title: string;
  onClick?: () => void;
  href?: string;
  finished?: boolean;
}

// TODO: get finished status from API
const getData = ($guide) =>
  [
    {
      title: 'Data modeling guide',
      onClick: () => $guide?.current?.play(LEARNING.DATA_MODELING_GUIDE),
    },
    {
      title: 'Creating a model',
      href: 'https://docs.getwren.ai/cloud/guide/modeling/models',
    },
    {
      title: 'Creating a view',
      href: 'https://docs.getwren.ai/cloud/guide/modeling/views',
    },
    {
      title: 'Working on relationship',
      href: 'https://docs.getwren.ai/cloud/guide/modeling/relationships',
    },
    {
      title: 'Connect to other data sources',
      href: 'https://docs.getwren.ai/cloud/guide/connect/overview',
    },
  ] as LearningConfig[];

const isLearningAccessible = (pathname: string) =>
  pathname.startsWith(Path.Modeling);

interface Props {}

export default function SidebarSection(_props: Props) {
  const router = useRouter();
  const [active, setActive] = useState(true);
  const $guide = useRef<any>(null);
  const $collapseBlock = useRef<HTMLDivElement>(null);
  const data = getData($guide);

  const total = useMemo(() => data.length, [data]);
  const current = useMemo(
    () => data.filter((item) => item.finished).length,
    [data],
  );

  const collapseBlock = (isActive: boolean) => {
    if ($collapseBlock.current) {
      const blockHeight = $collapseBlock.current.scrollHeight;
      $collapseBlock.current.style.height = isActive
        ? `${blockHeight}px`
        : '0px';
    }
  };

  useEffect(() => {
    collapseBlock(active);
  }, [active]);

  const onCollapseBarClick = () => {
    setActive(!active);
  };

  // Hide learning section if the page not in whitelist
  if (!isLearningAccessible(router.pathname)) return null;

  return (
    <>
      <LearningGuide ref={$guide} />
      <div className="border-t border-gray-4">
        <div
          className="px-4 py-1 d-flex align-center cursor-pointer select-none"
          onClick={onCollapseBarClick}
        >
          <div className="flex-grow-1">
            <ReadOutlined className="mr-1" />
            Learning
          </div>
          <RightOutlined
            className="text-sm"
            style={{ transform: `rotate(${active ? '90deg' : '0deg'})` }}
          />
        </div>
        <CollapseBlock ref={$collapseBlock}>
          <ListIterator data={data} />
          <div className="px-4 py-2 d-flex align-center">
            <Progress total={total} current={current} />
            <span className="text-xs gray-6 text-nowrap pl-2">
              {current}/{total} Finished
            </span>
          </div>
        </CollapseBlock>
      </div>
    </>
  );
}
