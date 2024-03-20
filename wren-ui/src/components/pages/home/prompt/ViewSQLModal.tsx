import { Modal } from 'antd';
import CodeBlock from '@/components/editor/CodeBlock';

export default function ShowSQLModal(props) {
  const { visible, onClose, defaultValue } = props;
  const { sql, summary } = defaultValue || {};
  return (
    <Modal
      title="SQL statement"
      width={560}
      visible={visible}
      onCancel={onClose}
      destroyOnClose
      centered
      footer={null}
    >
      <div className="mb-3">{summary}</div>
      <CodeBlock code={sql} showLineNumbers />
    </Modal>
  );
}
