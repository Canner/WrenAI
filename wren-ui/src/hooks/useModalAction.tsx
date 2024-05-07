import { useState } from 'react';
import { FORM_MODE } from '@/utils/enum';

export interface ModalAction<TData = any, SData = any> {
  visible: boolean;
  onClose: () => void;
  onSubmit?: (values: SData) => Promise<void>;
  formMode?: FORM_MODE;
  defaultValue?: TData;
  payload?: Record<string, any>;
}

export default function useModalAction() {
  const [visible, setVisible] = useState(false);
  const [formMode, setFormMode] = useState(FORM_MODE.CREATE);
  const [payload, setPayload] = useState(null);
  const [defaultValue, setDefaultValue] = useState(null);

  const openModal = (value?: any, payload?: any) => {
    payload && setPayload(payload);
    value && setDefaultValue(value);
    value && setFormMode(FORM_MODE.EDIT);
    setVisible(true);
  };

  const closeModal = () => {
    setVisible(false);
    setPayload(null);
    setDefaultValue(null);
    setFormMode(FORM_MODE.CREATE);
  };

  return {
    state: {
      visible,
      formMode,
      defaultValue,
      payload,
    },
    openModal,
    closeModal,
  };
}
