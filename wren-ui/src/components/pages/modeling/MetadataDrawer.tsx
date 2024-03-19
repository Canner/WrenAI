import { Drawer } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ModelMetadata, {
  Props as ModelMetadataProps,
} from './metadata/ModelMetadata';

type Metadata = { nodeType: NODE_TYPE } & ModelMetadataProps;

type Props = DrawerAction<Metadata>;

export default function MetadataDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;
  const { referenceName, nodeType = NODE_TYPE.MODEL } = defaultValue || {};

  return (
    <Drawer
      visible={visible}
      title={referenceName}
      width={760}
      closable
      destroyOnClose
      onClose={onClose}
    >
      {nodeType === NODE_TYPE.MODEL && <ModelMetadata {...defaultValue} />}
    </Drawer>
  );
}
