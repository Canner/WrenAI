import Icon from '@ant-design/icons';

export type IconsType = {
  icon: any;
  key: React.Key;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
};

interface GroupTitleProps {
  title: string;
  quotaUsage?: number;
  appendSlot?: React.ReactNode;
  icons: IconsType[];
}

const ActionIcons = ({ icons }: { icons: IconsType[] }) => {
  const iconComponents = icons.map(
    ({ key, icon, disabled = false, className = '', ...restProps }) => (
      <Icon
        key={key}
        component={icon}
        className={`adm-actionIcon ${className} ${
          disabled ? 'adm-actionIcon--disabled' : ''
        }`}
        {...restProps}
      />
    ),
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
      <ActionIcons {...restProps} />
    </>
  );
}
