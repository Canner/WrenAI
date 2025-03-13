import { Drawer, Typography } from 'antd';
import { DrawerAction } from '@/hooks/useDrawerAction';
import CodeBlock from '@/components/editor/CodeBlock';

type Props = DrawerAction<any>;

export default function SQLPairDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;

  return (
    <Drawer
      closable
      destroyOnClose
      onClose={onClose}
      title="View Question-SQL Pair"
      visible={visible}
      width={760}
    >
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">Question</Typography.Text>
        <div>{defaultValue?.question || '-'}</div>
      </div>
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">SQL Statement</Typography.Text>
        <CodeBlock
          code={defaultValue?.sql || ''}
          showLineNumbers
          maxHeight="500"
        />
      </div>
    </Drawer>
  );
}
