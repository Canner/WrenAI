import { Space } from 'antd';
import Image from 'next/image';

export default function LogoBar() {
  return (
    <Space size={[4, 0]}>
      <Image src="/images/logo.svg" alt="Logo" width={22} height={24} />
      <span className="logo-span">VulcanSQL</span>
    </Space>
  );
}
