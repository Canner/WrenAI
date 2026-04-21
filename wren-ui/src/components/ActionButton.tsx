import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { MoreIcon } from '@/utils/icons';

interface Props extends Omit<ButtonProps, 'icon' | 'type' | 'size'> {
  marginLeft?: number;
  marginRight?: number;
}

const makeActionButton = (icon: ReactNode, displayName: string) => {
  const ActionButton = forwardRef<HTMLButtonElement, Props>(
    function ActionButton(props, ref) {
      const {
        onClick,
        onMouseEnter,
        onMouseLeave,
        marginLeft,
        marginRight,
        style,
        ...restProps
      } = props;

      const click = (event: MouseEvent<HTMLElement>) => {
        onClick?.(event);
        event.stopPropagation();
      };
      const mouseEnter = (event: MouseEvent<HTMLElement>) => {
        onMouseEnter?.(event);
        event.stopPropagation();
      };
      const mouseLeave = (event: MouseEvent<HTMLElement>) => {
        onMouseLeave?.(event);
        event.stopPropagation();
      };

      return (
        <Button
          ref={ref}
          style={{ ...style, marginLeft, marginRight }}
          icon={icon}
          onClick={click}
          onMouseEnter={mouseEnter}
          onMouseLeave={mouseLeave}
          type="text"
          size="small"
          {...restProps}
        />
      );
    },
  );

  ActionButton.displayName = displayName;

  return ActionButton;
};

export const AddButton = makeActionButton(<PlusSquareOutlined />, 'AddButton');
export const MoreButton = makeActionButton(<MoreIcon />, 'MoreButton');
