import { useState } from 'react';

export default function useDropdown() {
  const [open, setOpen] = useState<boolean>(false);

  const onOpenChange = (nextOpen: boolean) => setOpen(nextOpen);

  const onCloseDropdownMenu = () => setOpen(false);

  return {
    open,
    onOpenChange,
    onCloseDropdownMenu,
  };
}
