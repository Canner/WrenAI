import { Typography } from 'antd';
import { StatusTag, verifiedStateOf } from '@/ui';
import type { TextAnswerPayload } from '../types';

interface Props {
  answer: TextAnswerPayload;
}

/**
 * The light, non-block answer form. The Verified/Unverified badge is shown
 * only for a data answer (`dataAnswer: true` — a query or dashboard build was
 * attempted, whether it succeeded or failed); a pure conversational reply
 * makes no data claim, so the badge is hidden entirely rather than showing a
 * misleading "Unverified".
 */
export function TextAnswer({ answer }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {answer.dataAnswer && <StatusTag state={verifiedStateOf(answer.verified)} />}
      <Typography.Paragraph style={{ marginBottom: 0 }}>{answer.text}</Typography.Paragraph>
    </div>
  );
}
