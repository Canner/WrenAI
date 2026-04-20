import { useEffect, type PropsWithChildren } from 'react';
import { App as AntdApp } from 'antd';
import { clearAntdAppBridge, setAntdAppBridge } from '@/utils/antdAppBridge';

export default function AntdAppBridge({ children }: PropsWithChildren) {
  const { message, modal, notification } = AntdApp.useApp();

  useEffect(() => {
    setAntdAppBridge({
      message,
      modal,
      notification,
    });

    return () => {
      clearAntdAppBridge();
    };
  }, [message, modal, notification]);

  return <>{children}</>;
}
