interface Props {
  size?: number;
  color?: string;
}

export const Logo = (props: Props) => {
  const { color = 'var(--gray-9)', size = 30 } = props;
  return null;
};
