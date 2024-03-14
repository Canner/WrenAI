import React, { useEffect, useState } from 'react';
import { Drawer, Form, FormInstance } from 'antd';
import { FORM_MODE, METRIC_STEP } from '@/utils/enum';
import { DrawerAction } from '@/hooks/useDrawerAction';
import MetricBasicForm, {
  ButtonGroup as MetricBasicButtonGroup,
  ButtonProps as MetricBasicButtonProps,
} from './form/MetricBasicForm';
import MetricDetailForm, {
  ButtonGroup as MetricDetailButtonGroup,
  ButtonProps as MetricDetailButtonProps,
} from './form/MetricDetailForm';

type Props = DrawerAction;

const DynamicForm = (props: {
  formMode: FORM_MODE;
  step: METRIC_STEP;
  form: FormInstance;
}) => {
  return (
    {
      [METRIC_STEP.ONE]: <MetricBasicForm {...props} />,
      [METRIC_STEP.TWO]: <MetricDetailForm {...props} />,
    }[props.step] || null
  );
};

const DynamicButtonGroup = (
  props: { step: METRIC_STEP; form: FormInstance } & MetricBasicButtonProps &
    MetricDetailButtonProps,
) => {
  return (
    {
      [METRIC_STEP.ONE]: <MetricBasicButtonGroup {...props} />,
      [METRIC_STEP.TWO]: <MetricDetailButtonGroup {...props} />,
    }[props.step] || null
  );
};

const getDrawerTitle = (formMode: FORM_MODE) =>
  ({
    [FORM_MODE.CREATE]: 'Create a metric',
    [FORM_MODE.EDIT]: 'Update a metric',
  })[formMode];

export default function MetricDrawer(props: Props) {
  const { visible, formMode, defaultValue, onClose, onSubmit } = props;
  const [internalValues, setInternalValues] = useState(defaultValue || null);
  const [step, setStep] = useState(METRIC_STEP.ONE);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const afterVisibleChange = (visible: boolean) => {
    if (!visible) {
      setStep(METRIC_STEP.ONE);
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
    setStep(METRIC_STEP.ONE);
  };

  const next = () => {
    form
      .validateFields()
      .then((values) => {
        setInternalValues({ ...internalValues, ...values });
        setStep(METRIC_STEP.TWO);
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
