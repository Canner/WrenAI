import React, { useEffect, useState } from 'react';
import { Drawer, Form, FormInstance } from 'antd';
import { FORM_MODE, MODEL_STEP } from '@/utils/enum';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ModelBasicForm, {
  ButtonGroup as ModelBasicButtonGroup,
  ButtonProps as ModelBasicButtonProps,
} from './form/ModelBasicForm';
import ModelDetailForm, {
  ButtonGroup as ModelDetailButtonGroup,
  ButtonProps as ModelDetailButtonProps,
} from './form/ModelDetailForm';

type Props = DrawerAction;

const DynamicForm = (props: {
  formMode: FORM_MODE;
  step: MODEL_STEP;
  form: FormInstance;
}) => {
  return (
    {
      [MODEL_STEP.ONE]: <ModelBasicForm {...props} />,
      [MODEL_STEP.TWO]: <ModelDetailForm {...props} />,
    }[props.step] || null
  );
};

const DynamicButtonGroup = (
  props: { step: MODEL_STEP; form: FormInstance } & ModelBasicButtonProps &
    ModelDetailButtonProps
) => {
  return (
    {
      [MODEL_STEP.ONE]: <ModelBasicButtonGroup {...props} />,
      [MODEL_STEP.TWO]: <ModelDetailButtonGroup {...props} />,
    }[props.step] || null
  );
};

const getDrawerTitle = (formMode: FORM_MODE) =>
  ({
    [FORM_MODE.CREATE]: 'Create a model',
    [FORM_MODE.EDIT]: 'Update a model',
  }[formMode]);

export default function ModelDrawer(props: Props) {
  const { visible, formMode, defaultValue, onClose, onSubmit } = props;
  const [internalValues, setInternalValues] = useState(defaultValue || null);
  const [step, setStep] = useState(MODEL_STEP.ONE);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const afterVisibleChange = (visible: boolean) => {
    if (!visible) {
      setStep(MODEL_STEP.ONE);
      form.resetFields();
      setInternalValues(null);
    }
  };

  const preview = () => {
    form
      .validateFields()
      .then((values) => {
        console.log({ ...internalValues, ...values });
      })
      .catch(console.error);
  };

  const back = () => {
    setStep(MODEL_STEP.ONE);
  };

  const next = () => {
    form
      .validateFields()
      .then((values) => {
        setInternalValues({ ...internalValues, ...values });
        setStep(MODEL_STEP.TWO);
      })
      .catch(console.error);
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({ ...internalValues, ...values });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Drawer
      visible={visible}
      title={getDrawerTitle(formMode)}
      width={750}
      closable
      destroyOnClose
      afterVisibleChange={afterVisibleChange}
      onClose={onClose}
      footer={
        <DynamicButtonGroup
          step={step}
          form={form}
          onCancel={onClose}
          onBack={back}
          onNext={next}
          onSubmit={submit}
          onPreview={preview}
        />
      }
      extra={<>Step {step}/2</>}
    >
      <DynamicForm formMode={formMode} step={step} form={form} />
    </Drawer>
  );
}
