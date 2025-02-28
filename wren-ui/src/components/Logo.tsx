import Image from 'next/image';

interface Props {
  size?: number;
}

export const Logo = (props: Props) => {
  const { size = 48 } = props;
  return (
    <Image
      src="/images/logo.svg"
      alt="ScientifiCloud AI"
      width={size}
      height={size}
    />
  );
};
