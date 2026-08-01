import { Typography } from 'antd';
import type { NarrativeBlock as NarrativeBlockData } from '../types';

interface Props {
  block: NarrativeBlockData;
}

/** A prose block (e.g. explain_change output). Rendered as plain paragraphs. */
export function NarrativeBlock({ block }: Props) {
  const paragraphs = block.text.split(/\n{2,}/).filter(Boolean);
  return (
    <div>
      {block.title ? (
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {block.title}
        </Typography.Title>
      ) : null}
      {paragraphs.map((p, i) => (
        <Typography.Paragraph key={i} style={{ marginBottom: 8 }}>
          {p}
        </Typography.Paragraph>
      ))}
    </div>
  );
}
