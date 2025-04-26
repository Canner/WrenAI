import { Drawer, Typography } from 'antd';
import { getCompactTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import { SqlPair } from '@/apollo/client/graphql/__types__';

type Props = DrawerAction<SqlPair>;

export default function SQLPairDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;

  return (
    <Drawer
      closable
      destroyOnClose
      onClose={onClose}
      title="View question-SQL pair"
      visible={visible}
      width={760}
    >
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">Question</Typography.Text>
        <div>{defaultValue?.question || '-'}</div>
      </div>
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">SQL statement</Typography.Text>
        <SQLCodeBlock
          code={defaultValue?.sql || ''}
          showLineNumbers
          maxHeight="500"
        />
      </div>
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">Created time</Typography.Text>
        <div>
          {defaultValue?.createdAt
            ? getCompactTime(defaultValue.createdAt)
            : '-'}
        </div>
      </div>
    </Drawer>
  );
}
