import { Fragment } from 'react';
import Icon from '@ant-design/icons';

export type ActionType = {
  icon?: React.ComponentType<{ className?: string }>;
  key: React.Key;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  render?: (props: { key: React.Key; disabled: boolean }) => React.ReactNode;
};

interface GroupTitleProps {
  title: string;
  quotaUsage?: number;
  appendSlot?: React.ReactNode;
  actions: ActionType[];
}

const Actions = ({ actions }: { actions: ActionType[] }) => {
  const iconComponents = (actions || []).map(
    ({ key, icon, render, disabled = false, className = '', ...restProps }) =>
      icon ? (
        <Icon
          key={key}
          component={icon}
          className={`adm-actionIcon ${className} ${
            disabled ? 'adm-actionIcon--disabled' : ''
          }`}
          {...restProps}
        />
      ) : render ? (
        <Fragment key={key}>{render({ key, disabled })}</Fragment>
      ) : null,
  );

  return (
    <span className="d-inline-flex align-center flex-shrink-0 g-2">
      {iconComponents}
    </span>
  );
};

export default function GroupTreeTitle({
  title,
  quotaUsage = 0,
  appendSlot,
  ...restProps
}: GroupTitleProps) {
  return (
    <>
      <span className="d-inline-flex align-center">
        {title}
        <span className="adm-treeNode-group-count ml-1 text-xs flex-grow-0">
          ({quotaUsage})
        </span>
        {appendSlot}
      </span>
      <Actions {...restProps} />
    </>
  );
}
