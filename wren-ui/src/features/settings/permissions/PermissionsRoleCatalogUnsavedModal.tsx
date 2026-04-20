import { Button, Modal, Typography } from 'antd';

const { Text } = Typography;

type Props = {
  loading: boolean;
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

export default function PermissionsRoleCatalogUnsavedModal({
  loading,
  onCancel,
  onDiscard,
  onSave,
  open,
}: Props) {
  return (
    <Modal
      open={open}
      title="有未保存改动"
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="discard" onClick={onDiscard}>
          放弃并继续
        </Button>,
        <Button key="save" type="primary" loading={loading} onClick={onSave}>
          保存并继续
        </Button>,
      ]}
    >
      <Text type="secondary">当前编辑内容尚未保存，是否先保存后再继续？</Text>
    </Modal>
  );
}
