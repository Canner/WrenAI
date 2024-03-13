import React, { useEffect, useState } from 'react';
import { Drawer, Form, FormInstance } from 'antd';
import { FORM_MODE, MODEL_STEP } from '@/utils/enum';
import { DrawerAction } from '@/hooks/useDrawerAction';
import ViewBasicForm, {
  ButtonGroup as ViewBasicButtonGroup,
  ButtonProps as ViewBasicButtonProps,
} from './form/ViewBasicForm';
import ViewDetailForm, {
  ButtonGroup as ViewDetailButtonGroup,
  ButtonProps as ViewDetailButtonProps,
} from './form/ViewDetailForm';

type Props = DrawerAction;

const DynamicForm = (props: {
  formMode: FORM_MODE;
  step: MODEL_STEP;
  form: FormInstance;
}) => {
  return (
    {
      [MODEL_STEP.ONE]: <ViewBasicForm {...props} />,
      [MODEL_STEP.TWO]: <ViewDetailForm {...props} />,
    }[props.step] || null
  );
};

const DynamicButtonGroup = (
  props: { step: MODEL_STEP; form: FormInstance } & ViewBasicButtonProps &
    ViewDetailButtonProps
) => {
  return (
    {
      [MODEL_STEP.ONE]: <ViewBasicButtonGroup {...props} />,
      [MODEL_STEP.TWO]: <ViewDetailButtonGroup {...props} />,
    }[props.step] || null
  );
};

const getDrawerTitle = (formMode: FORM_MODE) =>
  ({
    [FORM_MODE.CREATE]: 'Create a view',
    [FORM_MODE.EDIT]: 'Update a view',
  }[formMode]);

export default function ViewDrawer(props: Props) {
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
