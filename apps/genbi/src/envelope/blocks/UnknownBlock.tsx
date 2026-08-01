import { Alert } from 'antd';
import { t } from '@/i18n/strings';
import type { UnknownBlock as UnknownBlockData } from '../types';

interface Props {
  block: UnknownBlockData;
}

/**
 * Graceful fallback for block types this UI version does not render yet
 * (including future interactive/input blocks). Never throws — it shows a small
 * notice and the raw payload so the rest of the envelope still renders.
 */
export function UnknownBlock({ block }: Props) {
  return (
    <Alert
      type="info"
      showIcon
      message={`${t('envelope.unsupportedBlockPrefix')}${block.type}${t('envelope.unsupportedBlockSuffix')}`}
      description={
        <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto' }}>
          <code>{JSON.stringify(block, null, 2)}</code>
        </pre>
      }
    />
  );
}
