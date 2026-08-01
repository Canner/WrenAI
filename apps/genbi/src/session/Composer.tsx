import { useState } from 'react';
import { Button, Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { t } from '@/i18n/strings';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

/** Question input + send. Disabled while a turn is streaming. */
export function Composer({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Input
        aria-label={t('ask.composerLabel')}
        placeholder={t('ask.composerPlaceholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={submit}
        disabled={disabled}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={submit}
        disabled={disabled || !value.trim()}
      >
        {t('ask.send')}
      </Button>
    </div>
  );
}
