import { useState } from 'react';

export default function useDropdown() {
  const [visible, setVisible] = useState<boolean>(false);

  const onVisibleChange = (visible: boolean) => setVisible(visible);

  const onCloseDropdownMenu = () => setVisible(false);

  return {
    visible,
    onVisibleChange,
    onCloseDropdownMenu,
  };
}
