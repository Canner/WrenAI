import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { Form, Button } from 'antd';
import { JOIN_TYPE, NODE_TYPE } from '@/utils/enum';
import { useForm } from 'antd/lib/form/Form';
import useModalAction from '@/hooks/useModalAction';
import useModelFieldOptions from '@/hooks/useModelFieldOptions';
import AddCalculatedFieldModal from '@/components/modals/AddCalculatedFieldModal';
import AddMeasureFieldModal from '@/components/modals/AddMeasureFieldModal';
import AddDimensionFieldModal from '@/components/modals/AddDimensionFieldModal';
import AddWindowFieldModal from '@/components/modals/AddWindowFieldModal';
import AddRelationModal from '@/components/modals/AddRelationModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import MetricDrawer from '@/components/pages/modeling/MetricDrawer';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import SelectDataToExploreModal from '@/components/pages/explore/SelectDataToExploreModal';
import useDrawerAction from '@/hooks/useDrawerAction';

const ModelFieldSelector = dynamic(
  () => import('@/components/selectors/modelFieldSelector'),
  { ssr: false },
);

const initialValue = [
  { nodeType: NODE_TYPE.MODEL, name: 'Orders' },
  { nodeType: NODE_TYPE.MODEL, name: 'Lineitem' },
  { nodeType: NODE_TYPE.FIELD, name: 'orders', type: 'Orders' },
];

export default function Component() {
  const [form] = useForm();

  const addCalculatedFieldModal = useModalAction();
  const addMeasureFieldModal = useModalAction();
  const addDimensionFieldModal = useModalAction();
  const addWindowFieldModal = useModalAction();
  const addRelationModal = useModalAction();
  const selectDataToExploreModal = useModalAction();

  const modelDrawer = useDrawerAction();
  const metricDrawer = useDrawerAction();
  const metadataDrawer = useDrawerAction();

  const fieldOptions = useModelFieldOptions();
  const modelFields = Form.useWatch('modelFields', form);

  useEffect(() => {
    console.log('modelFields', modelFields);
  }, [modelFields]);

  return (
    <Form form={form} className="p-10">
      <Form.Item name="modelFields" initialValue={initialValue}>
        <ModelFieldSelector model="customer" options={fieldOptions} />
      </Form.Item>

      <div>
        value:
        <pre>
          <code>{JSON.stringify(modelFields, undefined, 2)}</code>
        </pre>
      </div>

      <Button
        onClick={() =>
          addCalculatedFieldModal.openModal({
            fieldName: 'test',
            expression: 'Sum',
            modelFields: [
              { nodeType: NODE_TYPE.MODEL, name: 'Orders' },
              { nodeType: NODE_TYPE.FIELD, name: 'orders', type: 'Orders' },
            ],
            // expression: 'customExpression',
            // customExpression: 'test',
          })
        }
      >
        Add calculated field
      </Button>

      <Button onClick={() => addMeasureFieldModal.openModal()}>
        Add measure field
      </Button>

      <Button onClick={() => addDimensionFieldModal.openModal()}>
        Add dimesion field
      </Button>

      <Button onClick={() => addWindowFieldModal.openModal()}>
        Add window field
      </Button>

      <Button onClick={addRelationModal.openModal}>Add relation field</Button>

      <Button onClick={() => modelDrawer.openDrawer()}>Model drawer</Button>

      <Button onClick={() => metricDrawer.openDrawer()}>Metric drawer</Button>

      <Button onClick={() => metadataDrawer.openDrawer()}>
        Metadata drawer
      </Button>

      <Button onClick={() => selectDataToExploreModal.openModal()}>
        Select data to explore
      </Button>

      <AddCalculatedFieldModal
        model="Customer"
        {...addCalculatedFieldModal.state}
        onSubmit={async (values) => {
          console.log(values);
        }}
        onClose={addCalculatedFieldModal.closeModal}
        // defaultValue={{
        //   fieldName: 'test',
        //   expression: 'Sum',
        //   modelFields: [
        //     { nodeType: NODE_TYPE.MODEL, name: 'Orders' },
        //     { nodeType: NODE_TYPE.FIELD, name: 'orders', type: 'Orders' },
        //   ],
        //   // expression: 'customExpression',
        //   // customExpression: 'test',
        // }}
      />

      <AddMeasureFieldModal
        model="Customer"
        {...addMeasureFieldModal.state}
        onSubmit={async (values) => {
          console.log(values);
        }}
        onClose={addMeasureFieldModal.closeModal}
      />

      <AddDimensionFieldModal
        model="Customer"
        {...addDimensionFieldModal.state}
        onSubmit={async (values) => {
          console.log(values);
        }}
        onClose={addDimensionFieldModal.closeModal}
      />

      <AddWindowFieldModal
        model="Customer"
        {...addWindowFieldModal.state}
        onSubmit={async (values) => {
          console.log(values);
        }}
        onClose={addWindowFieldModal.closeModal}
      />

      <AddRelationModal
        model="Customer"
        {...addRelationModal.state}
        onSubmit={async (values) => {
          console.log(values);
        }}
        onClose={addRelationModal.closeModal}
        defaultValue={{
          type: JOIN_TYPE.ONE_TO_ONE,
          fromField: {
            model: 'Customer',
            field: 'orders',
          },
          toField: {
            model: 'Lineitem',
            field: 'discount',
          },
          name: 'customer_orders',
          properties: {
            description: 'customer_orders_description',
          },
        }}
        relations={{}}
      />

      <ModelDrawer
        {...modelDrawer.state}
        onClose={modelDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
        defaultValue={{
          modelName: 'Customer',
          description: 'customer_description',
          table: 'customer',
          fields: [
            {
              name: 'custKey',
              type: 'UUID',
            },
          ],
          calculatedFields: [
            {
              fieldName: 'test',
              expression: 'Sum',
              modelFields: [
                { nodeType: NODE_TYPE.MODEL, name: 'customer' },
                { nodeType: NODE_TYPE.FIELD, name: 'custKey', type: 'UUID' },
              ],
            },
          ],
          cached: true,
          cachedPeriod: '1m',
        }}
      />

      <MetricDrawer
        {...metricDrawer.state}
        onClose={metricDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
      />

      <MetadataDrawer
        {...metadataDrawer.state}
        onClose={metadataDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
        defaultValue={{
          displayName: 'Customer',
          referenceName: 'Customer',
          sourceTableName: 'sourceTable',
          nodeType: NODE_TYPE.MODEL,
          fields: [
            {
              name: 'custKey',
              type: 'UUID',
            },
          ],
          calculatedFields: [
            {
              fieldName: 'test',
              expression: 'Sum',
              modelFields: [
                { nodeType: NODE_TYPE.MODEL, name: 'customer' },
                { nodeType: NODE_TYPE.FIELD, name: 'custKey', type: 'UUID' },
              ],
            },
          ],
          relationFields: [],
          properties: {},
        }}
      />

      <SelectDataToExploreModal
        {...selectDataToExploreModal.state}
        onClose={selectDataToExploreModal.closeModal}
      />
    </Form>
  );
}
