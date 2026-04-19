import { Tag, Typography } from 'antd';
import BookOutlined from '@ant-design/icons/BookOutlined';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import {
  ExploreHeaderBar,
  ExploreSegmentButton,
  ExploreSegmented,
  ExploreSourceHint,
  ExploreTitle,
  RecommendationCard,
  RecommendationIcon,
  RecommendationRow,
  RecommendationSection,
} from '../homePageStyles';

const { Text } = Typography;

export interface HomeRecommendationCard {
  question: string;
  badge: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  assetName?: string;
}

type HomeRecommendationSectionProps = {
  cards: HomeRecommendationCard[];
  sourceHint: string;
  onSelectQuestion: (card: HomeRecommendationCard) => void;
};

export default function HomeRecommendationSectionBlock({
  cards,
  sourceHint,
  onSelectQuestion,
}: HomeRecommendationSectionProps) {
  return (
    <RecommendationSection>
      <ExploreHeaderBar>
        <ExploreTitle>探索</ExploreTitle>
        <ExploreSegmented>
          <ExploreSegmentButton type="button" $active>
            案例广场
          </ExploreSegmentButton>
          <ExploreSegmentButton type="button" $disabled disabled>
            推荐模板
          </ExploreSegmentButton>
        </ExploreSegmented>
        <ExploreSourceHint>{sourceHint}</ExploreSourceHint>
      </ExploreHeaderBar>
      <RecommendationRow>
        {cards.map((card, index) => {
          const iconAccent = '#f3f4f6';

          return (
            <RecommendationCard
              key={`${card.knowledgeBaseId || 'recommendation'}-${card.question}-${index}`}
              type="button"
              $accent={iconAccent}
              aria-label={`使用案例问题：${card.question}${card.assetName ? `，来源资产：${card.assetName}` : ''}`}
              onClick={() => onSelectQuestion(card)}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <RecommendationIcon $accent={iconAccent}>
                  {index === 0 ? (
                    <FundViewOutlined />
                  ) : index === 1 ? (
                    <DatabaseOutlined />
                  ) : (
                    <BookOutlined />
                  )}
                </RecommendationIcon>
                <Tag
                  style={{
                    marginInlineEnd: 0,
                    borderRadius: 999,
                    borderColor: 'transparent',
                    color:
                      card.badge === '最新' ? 'var(--nova-primary)' : '#8a6b54',
                    background:
                      card.badge === '最新'
                        ? 'rgba(141, 101, 225, 0.08)'
                        : 'rgba(239, 225, 209, 0.56)',
                  }}
                >
                  {card.badge}
                </Tag>
              </div>
              <Text
                strong
                style={{
                  display: 'block',
                  fontSize: 16,
                  color: '#1d2435',
                  lineHeight: 1.6,
                }}
              >
                {card.question}
              </Text>
              {card.assetName ? (
                <Text
                  style={{
                    display: 'block',
                    marginTop: 12,
                    fontSize: 13,
                    color: 'var(--nova-text-secondary, #667085)',
                    lineHeight: 1.5,
                  }}
                >
                  来源资产 · {card.assetName}
                </Text>
              ) : null}
            </RecommendationCard>
          );
        })}
      </RecommendationRow>
    </RecommendationSection>
  );
}
