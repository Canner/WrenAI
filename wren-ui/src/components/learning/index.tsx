import {
  ComponentRef,
  MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { sortBy } from 'lodash';
import styled from 'styled-components';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import { IterableComponent, makeIterable } from '@/utils/iteration';
import LearningGuide from '@/components/learning/guide';
import { LEARNING } from './guide/utils';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useLearningRecordQuery,
  useSaveLearningRecordMutation,
} from '@/apollo/client/graphql/learning.generated';
import { nextTick } from '@/utils/time';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';
import { useUpdateCurrentProjectMutation } from '@/apollo/client/graphql/settings.generated';

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
    transition: width 0.3s;
  }
`;

const CollapseBlock = styled.div`
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
    text-decoration: ${({ finished }) => (finished ? 'line-through' : 'none')};
  }
`;

const ListTemplate = (props: IterableComponent<LearningConfig>) => {
  const { title, onClick, href, finished } = props;
  const as = href ? 'a' : 'div';
  const hrefAttrs = href
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
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
  id: LEARNING;
  title: string;
  onClick?: () => void;
  href?: string;
  finished?: boolean;
}

const getData = (
  $guide: MutableRefObject<ComponentRef<typeof LearningGuide>>,
  pathname: string,
  saveRecord: (id: LEARNING) => Promise<void>,
  saveLanguage: (value: ProjectLanguage) => Promise<void>,
) => {
  const getDispatcher = (id: LEARNING) => ({
    onDone: () => saveRecord(id),
    onSaveLanguage: saveLanguage,
  });

  const modeling = [
    {
      id: LEARNING.DATA_MODELING_GUIDE,
      title: 'Data modeling guide',
      onClick: () =>
        $guide?.current?.play(
          LEARNING.DATA_MODELING_GUIDE,
          getDispatcher(LEARNING.DATA_MODELING_GUIDE),
        ),
    },
    {
      id: LEARNING.CREATING_MODEL,
      title: 'Creating a model',
      href: 'https://docs.getwren.ai/oss/guide/modeling/models',
      onClick: () => saveRecord(LEARNING.CREATING_MODEL),
    },
    {
      id: LEARNING.CREATING_VIEW,
      title: 'Creating a view',
      href: 'https://docs.getwren.ai/oss/guide/modeling/views',
      onClick: () => saveRecord(LEARNING.CREATING_VIEW),
    },
    {
      id: LEARNING.WORKING_RELATIONSHIP,
      title: 'Working on relationship',
      href: 'https://docs.getwren.ai/oss/guide/modeling/relationships',
      onClick: () => saveRecord(LEARNING.WORKING_RELATIONSHIP),
    },
    {
      id: LEARNING.CONNECT_OTHER_DATA_SOURCES,
      title: 'Connect to other data sources',
      href: 'https://docs.getwren.ai/oss/guide/connect/overview',
      onClick: () => saveRecord(LEARNING.CONNECT_OTHER_DATA_SOURCES),
    },
  ] as LearningConfig[];

  const home = [
    {
      id: LEARNING.SWITCH_PROJECT_LANGUAGE,
      title: 'Switch the language',
      onClick: () =>
        $guide?.current?.play(
          LEARNING.SWITCH_PROJECT_LANGUAGE,
          getDispatcher(LEARNING.SWITCH_PROJECT_LANGUAGE),
        ),
    },
    {
      id: LEARNING.SHARE_RESULTS,
      title: 'Export to Excel/Sheets',
      href: 'https://docs.getwren.ai/oss/guide/integrations/excel-add-in',
      onClick: () => saveRecord(LEARNING.SHARE_RESULTS),
    },
    {
      id: LEARNING.VIEW_FULL_SQL,
      title: 'View full SQL',
      href: 'https://docs.getwren.ai/oss/guide/home/answer#view-sqlview-full-sql',
      onClick: () => saveRecord(LEARNING.VIEW_FULL_SQL),
    },
  ];

  if (pathname.startsWith(Path.Modeling)) {
    return modeling;
  } else if (pathname.startsWith(Path.Home)) {
    return home;
  }
  return [];
};

const isLearningAccessible = (pathname: string) =>
  pathname.startsWith(Path.Modeling) || pathname.startsWith(Path.Home);

interface Props {}

export default function SidebarSection(_props: Props) {
  const router = useRouter();
  const [active, setActive] = useState(true);
  const $guide = useRef<ComponentRef<typeof LearningGuide>>(null);
  const $collapseBlock = useRef<HTMLDivElement>(null);

  const { data: learningRecordResult } = useLearningRecordQuery();

  const [saveLearningRecord] = useSaveLearningRecordMutation({
    refetchQueries: ['LearningRecord'],
  });

  const [updateCurrentProject] = useUpdateCurrentProjectMutation({
    refetchQueries: ['GetSettings'],
  });

  const saveRecord = async (path: LEARNING) => {
    await saveLearningRecord({ variables: { data: { path } } });
  };

  const saveLanguage = async (value: ProjectLanguage) => {
    await updateCurrentProject({ variables: { data: { language: value } } });
  };

  const stories = useMemo(() => {
    const learningData = getData(
      $guide,
      router.pathname,
      saveRecord,
      saveLanguage,
    );
    const record = learningRecordResult?.learningRecord.paths || [];
    return sortBy(
      learningData.map((story) => ({
        ...story,
        finished: record.includes(story.id),
      })),
      'finished',
    );
  }, [learningRecordResult?.learningRecord]);

  const total = useMemo(() => stories.length, [stories]);
  const current = useMemo(
    () => stories.filter((item) => item?.finished).length,
    [stories],
  );

  const collapseBlock = async (isActive: boolean) => {
    if ($collapseBlock.current) {
      const blockHeight = $collapseBlock.current.scrollHeight;
      $collapseBlock.current.style.height = isActive
        ? `${blockHeight}px`
        : '0px';
      await nextTick(300);
      $collapseBlock.current.style.transition = 'height 0.3s';
    }
  };

  useEffect(() => {
    const learningRecord = learningRecordResult?.learningRecord;
    if (learningRecord) {
      setActive(
        stories.some((item) => !learningRecord.paths.includes(item.id)),
      );

      // play the data modeling guide if it's not finished
      if (
        router.pathname === Path.Modeling &&
        !learningRecord.paths.includes(LEARNING.DATA_MODELING_GUIDE)
      ) {
        nextTick(1000).then(() => {
          const isSkipBefore = !!window.sessionStorage.getItem(
            'skipDataModelingGuide',
          );
          if (isSkipBefore) return;
          $guide.current?.play(LEARNING.DATA_MODELING_GUIDE, {
            onDone: () => saveRecord(LEARNING.DATA_MODELING_GUIDE),
          });
        });
      }

      if (
        router.pathname === Path.Home &&
        !learningRecord.paths.includes(LEARNING.SWITCH_PROJECT_LANGUAGE)
      ) {
        nextTick(1000).then(() => {
          const isSkipBefore = !!window.sessionStorage.getItem(
            'skipSwitchProjectLanguageGuide',
          );
          if (isSkipBefore) return;
          $guide.current?.play(LEARNING.SWITCH_PROJECT_LANGUAGE, {
            onDone: () => saveRecord(LEARNING.SWITCH_PROJECT_LANGUAGE),
            onSaveLanguage: saveLanguage,
          });
        });
      }
    }
  }, [learningRecordResult?.learningRecord]);

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
          <ListIterator data={stories} />
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
