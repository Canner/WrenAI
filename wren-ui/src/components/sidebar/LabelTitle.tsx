interface LabelTitleProps {
  title: string;
  appendIcon?: React.ReactNode | null;
}

export default function LabelTitle({
  title,
  appendIcon = null,
}: LabelTitleProps) {
  return (
    <>
      <span className="adm-treeTitle__title" title={title}>
        {title}
      </span>
      {appendIcon && <span className="adm-actionIcon">{appendIcon}</span>}
    </>
  );
}
