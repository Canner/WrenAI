import PlusOutlined from '@ant-design/icons/PlusOutlined';
import {
  KbList,
  KbCreateButton,
  KbCreateInlineWrap,
  SidePanel,
} from '@/features/knowledgePage/index.styles';
import {
  SidebarKnowledgeList,
  type SidebarKnowledgeListProps,
} from '@/features/knowledgePage/lists';

type KnowledgeSidebarRailProps = SidebarKnowledgeListProps & {
  knowledgeTab: string;
  onChangeKnowledgeTab: (tab: string) => void;
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason?: string | null;
  onCreateKnowledgeBase: () => void;
};

export default function KnowledgeSidebarRail(props: KnowledgeSidebarRailProps) {
  const {
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    onCreateKnowledgeBase,
    visibleKnowledgeItems,
    visibleKnowledgeBaseId,
    activeKnowledgeBaseId,
    activeAssetCount,
    switchKnowledgeBase,
    buildKnowledgeSwitchUrl,
  } = props;

  return (
    <SidePanel>
      <KbList>
        <SidebarKnowledgeList
          visibleKnowledgeItems={visibleKnowledgeItems}
          visibleKnowledgeBaseId={visibleKnowledgeBaseId}
          activeKnowledgeBaseId={activeKnowledgeBaseId}
          activeAssetCount={activeAssetCount}
          switchKnowledgeBase={switchKnowledgeBase}
          buildKnowledgeSwitchUrl={buildKnowledgeSwitchUrl}
        />
        <KbCreateInlineWrap>
          <KbCreateButton
            type="default"
            icon={<PlusOutlined />}
            disabled={!canCreateKnowledgeBase}
            title={
              canCreateKnowledgeBase
                ? '创建知识库'
                : createKnowledgeBaseBlockedReason || undefined
            }
            onClick={onCreateKnowledgeBase}
          >
            创建知识库
          </KbCreateButton>
        </KbCreateInlineWrap>
      </KbList>
    </SidePanel>
  );
}
