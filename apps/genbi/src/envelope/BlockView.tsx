import { isKnownBlock, type AnyBlock } from './types';
import { KpiCardBlock } from './blocks/KpiCardBlock';
import { TableBlock } from './blocks/TableBlock';
import { ChartBlock } from './blocks/ChartBlock';
import { DefinitionBlock } from './blocks/DefinitionBlock';
import { NarrativeBlock } from './blocks/NarrativeBlock';
import { UnknownBlock } from './blocks/UnknownBlock';

interface Props {
  block: AnyBlock;
}

/** Dispatches a single block to its renderer; unknown types fall back safely. */
export function BlockView({ block }: Props) {
  if (!isKnownBlock(block)) {
    return <UnknownBlock block={block} />;
  }
  switch (block.type) {
    case 'kpi_card':
      return <KpiCardBlock block={block} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'chart':
      return <ChartBlock block={block} />;
    case 'definition':
      return <DefinitionBlock block={block} />;
    case 'narrative':
      return <NarrativeBlock block={block} />;
  }
}
