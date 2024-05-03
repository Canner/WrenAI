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

export default function useDrawerAction() {
  const [visible, setVisible] = useState(false);
  const [formMode, setFormMode] = useState(FORM_MODE.CREATE);
  const [defaultValue, setDefaultValue] = useState(null);

  const openDrawer = (value?: any) => {
    value && setDefaultValue(value);
    value && setFormMode(FORM_MODE.EDIT);
    setVisible(true);
  };

  const closeDrawer = () => {
    setVisible(false);
    setDefaultValue(null);
    setFormMode(FORM_MODE.CREATE);
  };

  const updateState = (value?: any) => {
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
