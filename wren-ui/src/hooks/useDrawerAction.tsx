import { useState } from 'react';
import { FORM_MODE } from '@/utils/enum';

export interface DrawerAction<TData = any> {
  visible: boolean;
  onClose: () => void;
  onSubmit?: (values: any) => Promise<void>;
  formMode?: FORM_MODE;
  // use as form default value or view data
  defaultValue?: TData;
}

export default function useDrawerAction<TData = any>() {
  const [visible, setVisible] = useState(false);
  const [formMode, setFormMode] = useState(FORM_MODE.CREATE);
  const [defaultValue, setDefaultValue] = useState<TData | undefined>(
    undefined,
  );

  const openDrawer = (value?: TData) => {
    if (value !== undefined && value !== null) {
      setDefaultValue(value);
      setFormMode(FORM_MODE.EDIT);
    }
    setVisible(true);
  };

  const closeDrawer = () => {
    setVisible(false);
    setDefaultValue(undefined);
    setFormMode(FORM_MODE.CREATE);
  };

  const updateState = (value?: TData) => {
    setDefaultValue(value);
  };

  return {
    state: {
      visible,
      formMode,
      defaultValue,
    },
    openDrawer,
    closeDrawer,
    updateState,
  };
}
