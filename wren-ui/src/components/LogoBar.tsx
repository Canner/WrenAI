import Image from 'next/image';

export default function LogoBar() {
  return (
    <Image
      src="/images/logo-with-text.svg"
      alt="ScientifiCloud AI"
      width={100}
      height={30}
    />
  );
}
