import { Typography } from 'antd';
import {
  Bubble,
  InlineCardMeta,
  InlinePreviewCard,
  InsightBlock,
  ReferenceConversation,
  SpeakerBadge,
  SpeakerRow,
  StatusLine,
  SubtleBadge,
  SuggestionChip,
  SuggestionChipRow,
  SuggestionShell,
  ThinkingLine,
} from '../threadPageStyles';

const { Text } = Typography;

const REFERENCE_FOLLOW_UPS = [
  '从折线图中移除离群值',
  '为折线图添加标签',
  '将标题重新命名为“单位成本趋势”',
  '推荐几个问题给我',
];

type ReferenceConversationPreviewProps = {
  question: string;
  onSelectSuggestedQuestion?: (value: string) => void;
};

export default function ReferenceConversationPreview({
  question,
  onSelectSuggestedQuestion,
}: ReferenceConversationPreviewProps) {
  return (
    <ReferenceConversation>
      <SpeakerRow>
        <SpeakerBadge $tone="user">XL</SpeakerBadge>
        <Bubble>
          <Text
            strong
            style={{
              display: 'block',
              fontSize: 18,
              color: '#252b3a',
              marginBottom: 6,
            }}
          >
            {question}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            当前示例会沿用该线程历史使用的知识库继续分析，你可以直接继续追问。
          </Text>
        </Bubble>
      </SpeakerRow>

      <SpeakerRow>
        <SpeakerBadge $tone="assistant">AI</SpeakerBadge>
        <StatusLine>谢谢你的提问，我正在处理中。</StatusLine>
      </SpeakerRow>

      <div style={{ paddingLeft: 46 }}>
        <ThinkingLine>实时模式下这里会展示执行思路与推理过程</ThinkingLine>
      </div>

      <InlinePreviewCard>
        <InlineCardMeta>
          <Text strong>数据预览</Text>
          <Text type="secondary">
            会基于当前线程的真实运行时上下文返回预览结果
          </Text>
        </InlineCardMeta>
        <SubtleBadge>示例结果</SubtleBadge>
      </InlinePreviewCard>

      <InsightBlock>
        <p>
          当前示例会根据问题 <b>「{question}」</b> 生成结构化结果、图表建议
          与后续追问入口，这里展示的是线程页在实时模式下的占位参考态。
        </p>
        <p>
          当真实数据返回后，页面会展示对应的 SQL、数据预览、文本总结与图表；
          如果图表正在生成中，这一段会被实际的进度、推理与结果卡片替换。
        </p>
        <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
          <li>先展示与当前线程绑定的知识库和运行时上下文</li>
          <li>再依次呈现可解释的分析过程、数据预览与最终结论</li>
          <li>最后给出可继续点击的推荐追问，帮助快速深入分析</li>
        </ul>
      </InsightBlock>

      <SuggestionShell>
        <Text type="secondary">推荐追问</Text>
        <SuggestionChipRow>
          {REFERENCE_FOLLOW_UPS.map((item) => (
            <SuggestionChip
              key={item}
              type="button"
              onClick={() => onSelectSuggestedQuestion?.(item)}
            >
              {item}
            </SuggestionChip>
          ))}
        </SuggestionChipRow>
      </SuggestionShell>
    </ReferenceConversation>
  );
}
