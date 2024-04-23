import { Button } from 'antd';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { MoreIcon } from '@/utils/icons';

interface Props {
  onClick?: (event: React.MouseEvent) => void;
  className?: string;
  marginLeft?: number;
  marginRight?: number;
}

const makeActionButton = (icon: React.ReactNode) => (props: Props) => {
  const { onClick, className, marginLeft, marginRight } = props;
  const click = (event) => {
    onClick && onClick(event);
    event.stopPropagation();
  };
  return (
    <Button
      className={className}
      style={{ marginLeft, marginRight }}
      icon={icon}
      onClick={click}
      type="text"
      size="small"
    />
  );
};

export const AddButton = makeActionButton(<PlusSquareOutlined />);
export const MoreButton = makeActionButton(<MoreIcon />);
