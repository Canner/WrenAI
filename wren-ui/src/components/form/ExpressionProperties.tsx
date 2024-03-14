import { Form, FormInstance, Input } from 'antd';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import useExpressionFieldOptions, {
  CUSTOM_EXPRESSION_VALUE,
} from '@/hooks/useExpressionFieldOptions';
import ModelFieldSelector from '@/components/selectors/modelFieldSelector';
import { modelFieldSelectorValidator } from '@/utils/validator';
import ExpressionSelector from '../selectors/ExpressionSelector';
import useModelFieldOptions, {
  ModelFieldResposeData,
} from '@/hooks/useModelFieldOptions';

interface Props {
  model: string;
  form: FormInstance;

  // The transientData is used to get the model fields which are not created in DB yet.
  transientData?: ModelFieldResposeData[];
}

export default function ExpressionProperties(props: Props) {
  const { form, model, transientData } = props;

  const expression = Form.useWatch('expression', form);

  const expressionOptions = useExpressionFieldOptions();
  const modelFieldOptions = useModelFieldOptions(transientData);

  return (
    <>
      <Form.Item
        label="Select an expression"
        name="expression"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.EXPRESS_PROPERTIES.EXPRESSION.REQUIRED,
          },
        ]}
      >
        <ExpressionSelector options={expressionOptions} />
      </Form.Item>
      <div className="py-1" />
      {expression === CUSTOM_EXPRESSION_VALUE ? (
        <div className="bg-gray-2 px-10 py-4">
          <Form.Item
            label="Expression"
            required
            name="customExpression"
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.EXPRESS_PROPERTIES.CUSTOM_FIELD.REQUIRED,
              },
            ]}
          >
            <Input addonBefore={<FunctionOutlined />} />
          </Form.Item>
        </div>
      ) : (
        <Form.Item
          name="modelFields"
          rules={[
            {
              validator: modelFieldSelectorValidator(
                ERROR_TEXTS.EXPRESS_PROPERTIES.MODEL_FIELD,
              ),
            },
          ]}
        >
          <ModelFieldSelector model={model} options={modelFieldOptions} />
        </Form.Item>
      )}
    </>
  );
}
