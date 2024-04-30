import { Button, Drawer } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import EditOutlined from '@ant-design/icons/EditOutlined';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ModelMetadata, {
  Props as ModelMetadataProps,
} from './metadata/ModelMetadata';
import ViewMetadata, {
  Props as ViewMetadataProps,
} from './metadata/ViewMetadata';

type Metadata = {
  nodeType: NODE_TYPE;
} & ModelMetadataProps &
  ViewMetadataProps;

type Props = DrawerAction<Metadata> & { onEditClick: (value?: any) => void };

export default function MetadataDrawer(props: Props) {
  const { visible, defaultValue, onClose, onEditClick } = props;
  const { referenceName, nodeType = NODE_TYPE.MODEL } = defaultValue || {};

  return (
    <Drawer
      visible={visible}
      title={referenceName}
      width={760}
      closable
      destroyOnClose
      onClose={onClose}
      extra={
        <Button
          icon={<EditOutlined />}
          onClick={() => onEditClick(defaultValue)}
        >
          Edit
        </Button>
      }
    >
      {nodeType === NODE_TYPE.MODEL && <ModelMetadata {...defaultValue} />}
      {nodeType === NODE_TYPE.VIEW && <ViewMetadata {...defaultValue} />}
    </Drawer>
  );
}
