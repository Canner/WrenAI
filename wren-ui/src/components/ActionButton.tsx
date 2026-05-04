import { Button } from 'antd';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { MoreIcon } from '@/utils/icons';

interface Props {
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: (event: React.MouseEvent) => void;
  onMouseLeave?: (event: React.MouseEvent) => void;
  className?: string;
  marginLeft?: number;
  marginRight?: number;
}

const makeActionButton = (icon: React.ReactNode) => (props: Props) => {
  const {
    onClick,
    onMouseEnter,
    onMouseLeave,
    className,
    marginLeft,
    marginRight,
    ...restProps
  } = props;
  const click = (event) => {
    onClick && onClick(event);
    event.stopPropagation();
  };
  const mouseEnter = (event) => {
    onMouseEnter && onMouseEnter(event);
    event.stopPropagation();
  };
  const mouseLeave = (event) => {
    onMouseLeave && onMouseLeave(event);
    event.stopPropagation();
  };
  return (
    <Button
      className={className}
      style={{ marginLeft, marginRight }}
      icon={icon}
      onClick={click}
      onMouseEnter={mouseEnter}
      onMouseLeave={mouseLeave}
      type="text"
      size="small"
      {...restProps}
    />
  );
};

export const AddButton = makeActionButton(<PlusSquareOutlined />);
export const MoreButton = makeActionButton(<MoreIcon />);
