/*
 * use client import to avoid bundle size issue
 */

import dynamic from 'next/dynamic';
export type { IconComponentProps } from '@ant-design/icons/lib/components/Icon';

const Icon = dynamic(() => import('@ant-design/icons/lib/components/Icon'), {
  ssr: false,
});

export default Icon;
