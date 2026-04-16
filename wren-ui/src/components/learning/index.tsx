import {
  ComponentRef,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { sortBy } from 'lodash';
import { message } from 'antd';
import styled from 'styled-components';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import { IterableComponent, makeIterable } from '@/utils/iteration';
import LearningGuide from '@/components/learning/guide';
import { LEARNING } from './guide/utils';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { nextTick } from '@/utils/time';
import { ProjectLanguage } from '@/types/api';
import { Dispatcher } from '@/components/learning/guide/utils';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  fetchLearningRecord,
  saveLearningRecord as saveLearningRecordByRest,
} from '@/utils/learningRest';
import { updateCurrentProjectLanguage } from '@/utils/settingsRest';

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
      finished={Boolean(finished)}
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
  $guide: RefObject<ComponentRef<typeof LearningGuide>>,
  pathname: string,
  saveRecord: (id: LEARNING) => Promise<void>,
  saveLanguage: NonNullable<Dispatcher['onSaveLanguage']>,
) => {
  const getDispatcher = (id: LEARNING) => ({
    onDone: () => saveRecord(id),
    onSaveLanguage: saveLanguage,
  });

  const modeling = [
    {
      id: LEARNING.DATA_MODELING_GUIDE,
      title: '数据建模指南',
      onClick: () =>
        $guide?.current?.play(
          LEARNING.DATA_MODELING_GUIDE,
          getDispatcher(LEARNING.DATA_MODELING_GUIDE),
        ),
    },
    {
      id: LEARNING.CREATING_MODEL,
      title: '创建模型',
      href: 'https://docs.getwren.ai/oss/guide/modeling/models',
      onClick: () => saveRecord(LEARNING.CREATING_MODEL),
    },
    {
      id: LEARNING.CREATING_VIEW,
      title: '创建视图',
      href: 'https://docs.getwren.ai/oss/guide/modeling/views',
      onClick: () => saveRecord(LEARNING.CREATING_VIEW),
    },
    {
      id: LEARNING.WORKING_RELATIONSHIP,
      title: '管理关系',
      href: 'https://docs.getwren.ai/oss/guide/modeling/relationships',
      onClick: () => saveRecord(LEARNING.WORKING_RELATIONSHIP),
    },
    {
      id: LEARNING.CONNECT_OTHER_DATA_SOURCES,
      title: '接入其他数据源',
      href: 'https://docs.getwren.ai/oss/guide/connect/overview',
      onClick: () => saveRecord(LEARNING.CONNECT_OTHER_DATA_SOURCES),
    },
  ] as LearningConfig[];

  const home = [
    {
      id: LEARNING.SWITCH_PROJECT_LANGUAGE,
      title: '切换对话语言',
      onClick: () =>
        $guide?.current?.play(
          LEARNING.SWITCH_PROJECT_LANGUAGE,
          getDispatcher(LEARNING.SWITCH_PROJECT_LANGUAGE),
        ),
    },
    {
      id: LEARNING.VIEW_FULL_SQL,
      title: '查看完整 SQL',
      href: 'https://docs.getwren.ai/oss/guide/home/answer#view-sqlview-full-sql',
      onClick: () => saveRecord(LEARNING.VIEW_FULL_SQL),
    },
  ];

  if (pathname.startsWith(Path.Modeling)) {
    return modeling;
  }
  if (pathname.startsWith(Path.Home)) {
    return home;
  }
  return [];
};

const isLearningAccessible = (pathname: string) =>
  pathname.startsWith(Path.Modeling) || pathname.startsWith(Path.Home);

interface Props {}

export default function SidebarSection(_props: Props) {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [active, setActive] = useState(true);
  const $guide = useRef<ComponentRef<typeof LearningGuide>>(null);
  const $collapseBlock = useRef<HTMLDivElement>(null);
  const [learningRecordPaths, setLearningRecordPaths] = useState<
    string[] | null
  >(null);

  useEffect(() => {
    if (!runtimeScopeNavigation.hasRuntimeScope) {
      setLearningRecordPaths([]);
      return;
    }

    let cancelled = false;

    void fetchLearningRecord(runtimeScopeNavigation.selector)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setLearningRecordPaths(payload.paths);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        message.error(
          error instanceof Error
            ? error.message
            : '加载学习记录失败，请稍后重试。',
        );
        setLearningRecordPaths([]);
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScopeNavigation.hasRuntimeScope, runtimeScopeNavigation.selector]);

  const saveRecord = useCallback(
    async (path: LEARNING) => {
      try {
        const payload = await saveLearningRecordByRest(
          runtimeScopeNavigation.selector,
          path,
        );
        setLearningRecordPaths(payload.paths);
      } catch (error) {
        message.error(
          error instanceof Error
            ? error.message
            : '保存学习记录失败，请稍后重试。',
        );
        throw error;
      }
    },
    [runtimeScopeNavigation.selector],
  );

  const saveLanguage = useCallback(
    async (value: ProjectLanguage) => {
      try {
        await updateCurrentProjectLanguage(
          runtimeScopeNavigation.selector,
          value,
        );
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : '切换语言失败，请稍后重试。',
        );
        throw error;
      }
    },
    [runtimeScopeNavigation.selector],
  );

  const saveLanguageFromGuide = useCallback(
    async (value: string) => {
      await saveLanguage(value as ProjectLanguage);
    },
    [saveLanguage],
  );

  const stories = useMemo(() => {
    const learningData = getData(
      $guide,
      router.pathname,
      saveRecord,
      saveLanguageFromGuide,
    );
    const record = learningRecordPaths || [];
    return sortBy(
      learningData.map((story) => ({
        ...story,
        finished: record.includes(story.id),
      })),
      'finished',
    );
  }, [learningRecordPaths, router.pathname, saveRecord, saveLanguageFromGuide]);

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
      $collapseBlock.current &&
        ($collapseBlock.current.style.transition = 'height 0.3s');
    }
  };

  useEffect(() => {
    if (!learningRecordPaths) {
      return;
    }

    setActive(stories.some((item) => !learningRecordPaths.includes(item.id)));

    const routerActions: Record<string, () => Promise<void>> = {
      [Path.Modeling]: async () => {
        const isGuideDone = learningRecordPaths.includes(
          LEARNING.DATA_MODELING_GUIDE,
        );
        const isSkipBefore = !!window.sessionStorage.getItem(
          'skipDataModelingGuide',
        );
        if (!(isGuideDone || isSkipBefore)) {
          await nextTick(1000);
          $guide.current?.play(LEARNING.DATA_MODELING_GUIDE, {
            onDone: () => saveRecord(LEARNING.DATA_MODELING_GUIDE),
          });
        }
      },
      [Path.Home]: async () => {
        const isGuideDone = learningRecordPaths.includes(
          LEARNING.SWITCH_PROJECT_LANGUAGE,
        );
        const isSkipBefore = !!window.sessionStorage.getItem(
          'skipSwitchProjectLanguageGuide',
        );
        if (!(isGuideDone || isSkipBefore)) {
          await nextTick(1000);
          $guide.current?.play(LEARNING.SWITCH_PROJECT_LANGUAGE, {
            onDone: () => saveRecord(LEARNING.SWITCH_PROJECT_LANGUAGE),
            onSaveLanguage: saveLanguageFromGuide,
          });
        }
      },
      [Path.Thread]: async () => {
        const isGuideDone = learningRecordPaths.includes(
          LEARNING.SAVE_TO_KNOWLEDGE,
        );
        if (!isGuideDone) {
          await nextTick(1500);
          $guide.current?.play(LEARNING.SAVE_TO_KNOWLEDGE, {
            onDone: () => saveRecord(LEARNING.SAVE_TO_KNOWLEDGE),
          });
        }
      },
      [Path.Knowledge]: async () => {
        const isGuideDone = learningRecordPaths.includes(
          LEARNING.KNOWLEDGE_GUIDE,
        );
        if (!isGuideDone) {
          await nextTick(1000);
          $guide.current?.play(LEARNING.KNOWLEDGE_GUIDE, {
            onDone: () => saveRecord(LEARNING.KNOWLEDGE_GUIDE),
          });
        }
      },
    };
    const routerAction = Object.entries(routerActions).find(([path]) =>
      router.pathname.startsWith(path),
    )?.[1];
    void routerAction?.();
  }, [
    learningRecordPaths,
    router.pathname,
    saveLanguageFromGuide,
    saveRecord,
    stories,
  ]);

  useEffect(() => {
    collapseBlock(active);
  }, [active]);

  const onCollapseBarClick = () => {
    setActive(!active);
  };

  return (
    <>
      <LearningGuide ref={$guide} />
      {isLearningAccessible(router.pathname) && (
        <div className="border-t border-gray-4">
          <div
            className="px-4 py-1 d-flex align-center cursor-pointer select-none"
            onClick={onCollapseBarClick}
          >
            <div className="flex-grow-1">
              <ReadOutlined className="mr-1" />
              学习中心
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
                已完成 {current}/{total}
              </span>
            </div>
          </CollapseBlock>
        </div>
      )}
    </>
  );
}
