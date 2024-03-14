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

  return <>{iconComponents}</>;
};

export default function GroupTreeTitle({
  title,
  quotaUsage = 0,
  ...restProps
}: GroupTitleProps) {
  return (
    <>
      <span>
        {title}
        <span className="adm-treeNode-group-count ml-1 text-xs">
          ({quotaUsage})
        </span>
      </span>
      <ActionIcons {...restProps} />
    </>
  );
}
