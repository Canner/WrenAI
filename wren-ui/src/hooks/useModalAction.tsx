import { useState } from 'react';
import { FORM_MODE } from '@/utils/enum';

export interface ModalAction<TData = any, SData = any, SPayload = any> {
  visible: boolean;
  onClose: () => void;
  onSubmit?: (values: SData) => Promise<void>;
  formMode?: FORM_MODE;
  defaultValue?: TData;
  payload?: SPayload;
}

export default function useModalAction<TData = any, SPayload = any>() {
  const [visible, setVisible] = useState(false);
  const [formMode, setFormMode] = useState(FORM_MODE.CREATE);
  const [payload, setPayload] = useState<SPayload | undefined>(undefined);
  const [defaultValue, setDefaultValue] = useState<TData | undefined>(
    undefined,
  );

  const openModal = (value?: TData, payload?: SPayload) => {
    if (payload) {
      setPayload(payload);
    }
    if (value !== undefined && value !== null) {
      setDefaultValue(value);
      setFormMode(FORM_MODE.EDIT);
    }
    setVisible(true);
  };

  const closeModal = () => {
    setVisible(false);
    setPayload(undefined);
    setDefaultValue(undefined);
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
