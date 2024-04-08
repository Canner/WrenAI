import { useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Menu, Modal, Input, Row, Col, Typography, Empty } from 'antd';
import { ItemType } from 'antd/lib/menu/hooks/useItems';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import { compact } from 'lodash';
import { MetricIcon, ModelIcon, ViewIcon } from '@/utils/icons';
import { NODE_TYPE } from '@/utils/enum';
import { makeMetadataBaseTable } from '@/components/table/MetadataBaseTable';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import MeasureFieldTable from '@/components/table/MeasureFieldTable';
import DimensionFieldTable from '@/components/table/DimensionFieldTable';
import WindowFieldTable from '@/components/table/WindowFieldTable';
import useSelectDataToExploreCollections from '@/hooks/useSelectDataToExploreCollections';

const StyledMenu = styled(Menu)`
  border-right: none;

  .ant-menu-item-group-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--gray-8);
    padding: 8px 8px 0;
  }

  .ant-menu-item {
    padding: 0;
    margin: 4px 0 !important;
    padding-left: 8px !important;
    height: 32px;
    line-height: 32px;
    background: transparent;
    color: var(--gray-9) !important;
    border-radius: 4px;

    &:hover {
      background: var(--gray-2);
    }

    &.ant-menu-item-selected {
      background: var(--gray-3);
      border-radius: 4px;

      &:after {
        display: none;
      }
    }
  }
`;

const MENU = {
  MODEL: 'Models',
  METRIC: 'Metrics',
  VIEW: 'Views',
};

const MENU_GROUPS = {
  [MENU.MODEL]: {
    label: 'Models',
    type: 'group',
  },
  [MENU.METRIC]: {
    label: 'Metrics',
    type: 'group',
  },
  [MENU.VIEW]: {
    label: 'Views',
    type: 'group',
  },
};

type Props = ModalAction & {
  loading?: boolean;
};

const ModelMetadata = ({
  table,
  description,
  fields = [],
  calculatedFields = [],
  relations = [],
}) => {
  const FieldMetadataTable = makeMetadataBaseTable(FieldTable)();
  const CalculatedFieldMetadataTable =
    makeMetadataBaseTable(CalculatedFieldTable)();
  const RelationMetadataTable = makeMetadataBaseTable(RelationTable)();

  return (
    <>
      <Row className="mb-6">
        <Col span={12}>
          <div className="gray-7 mb-2">Description</div>
          <div>{description || '-'}</div>
        </Col>
        <Col span={12}>
          <div className="gray-7 mb-2">Source table name</div>
          <div>{table}</div>
        </Col>
      </Row>
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Fields ({fields.length})
        </Typography.Text>
        <FieldMetadataTable dataSource={fields} />
      </div>

      {!!calculatedFields.length && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Calculated fields ({calculatedFields.length})
          </Typography.Text>
          <CalculatedFieldMetadataTable dataSource={calculatedFields} />
        </div>
      )}

      {!!relations.length && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Relationships ({relations.length})
          </Typography.Text>
          <RelationMetadataTable dataSource={relations} />
        </div>
      )}
    </>
  );
};

const MetricMetadata = ({
  description,
  measures = [],
  dimensions = undefined,
  windows = undefined,
}) => {
  const MeasureFieldMetadataTable = makeMetadataBaseTable(MeasureFieldTable)();
  const DimensionFieldMetadataTable =
    makeMetadataBaseTable(DimensionFieldTable)();
  const WindowFieldMetadataTable = makeMetadataBaseTable(WindowFieldTable)();

  return (
    <>
      <Row className="mb-6">
        <Col span={12}>
          <div className="gray-7 mb-2">Description</div>
          <div>{description || '-'}</div>
        </Col>
      </Row>
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Measures ({measures.length})
        </Typography.Text>
        <MeasureFieldMetadataTable dataSource={measures} />
      </div>

      {!!dimensions && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Dimensions ({dimensions.length})
          </Typography.Text>
          <DimensionFieldMetadataTable dataSource={dimensions} />
        </div>
      )}

      {!!windows && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Windows ({windows.length})
          </Typography.Text>
          <WindowFieldMetadataTable dataSource={windows} />
        </div>
      )}
    </>
  );
};

const ViewMetadata = ({ description, fields = [] }) => {
  const FieldMetadataTable = makeMetadataBaseTable(FieldTable)();

  return (
    <>
      <Row className="mb-6">
        <Col span={12}>
          <div className="gray-7 mb-2">Description</div>
          <div>{description || '-'}</div>
        </Col>
      </Row>
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Fields ({fields.length})
        </Typography.Text>
        <FieldMetadataTable dataSource={fields} />
      </div>
    </>
  );
};

export default function SelectDataToExploreModal(props: Props) {
  const { visible, loading, onClose, onSubmit } = props;
  const [searchValue, setSearchValue] = useState('');
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const { models, metrics, views } = useSelectDataToExploreCollections();

  const goToExplore = async () => {
    onSubmit && (await onSubmit(selectedItem));
    onClose();
  };

  const search = (event) => {
    const value = event.target.value;
    setSearchValue(value.trim());
  };

  const clickMenu = useCallback(
    (item: ItemType) => {
      const [type, id] = (item.key as string).split('_');
      if (type === MENU.MODEL) {
        setSelectedItem(models.find((model) => model.id === id));
      } else if (type === MENU.METRIC) {
        setSelectedItem(metrics.find((metric) => metric.id === id));
      } else if (type === MENU.VIEW) {
        setSelectedItem(views.find((view) => view.id === id));
      }
    },
    [models, metrics, views],
  );

  const reset = () => {
    setSearchValue('');
    setSelectedItem(null);
  };

  const getLabel = useCallback(
    (label: string, Icon) => {
      let nextLabel: React.ReactNode = label;
      if (searchValue) {
        const regex = new RegExp(searchValue, 'gi');
        const splitedLabel = label.split(regex);

        const matchTexts = label.match(regex);
        const restructure = matchTexts
          ? matchTexts.reduce((result, text, index) => {
              return (
                result +
                splitedLabel.shift() +
                `<span class="red-5">${text}</span>` +
                // the last part of the label
                (index === matchTexts.length - 1 ? splitedLabel.pop() : '')
              );
            }, '')
          : label;

        nextLabel = <span dangerouslySetInnerHTML={{ __html: restructure }} />;
      }

      return (
        <div className="d-flex align-center">
          <Icon className="mr-2" />
          {nextLabel}
        </div>
      );
    },
    [searchValue],
  );

  const menu = useMemo(() => {
    const filterSearch = (item) =>
      item.name.toLowerCase().includes(searchValue.toLowerCase());

    const modelItems = models.filter(filterSearch).map((model) => ({
      label: getLabel(model.name, ModelIcon),
      key: `${MENU.MODEL}_${model.id}`,
    }));

    const metricItems = metrics.filter(filterSearch).map((metric) => ({
      label: getLabel(metric.name, MetricIcon),
      key: `${MENU.METRIC}_${metric.id}`,
    }));

    const viewItems = views.filter(filterSearch).map((view) => ({
      label: getLabel(view.name, ViewIcon),
      key: `${MENU.VIEW}_${view.id}`,
    }));

    const getGroupItems = (group: Record<string, any>, items: any[]) => {
      return items.length ? { ...group, children: items } : undefined;
    };

    const result = compact([
      getGroupItems(MENU_GROUPS[MENU.MODEL], modelItems),
      getGroupItems(MENU_GROUPS[MENU.METRIC], metricItems),
      getGroupItems(MENU_GROUPS[MENU.VIEW], viewItems),
    ]) as ItemType[];

    return result;
  }, [models, metrics, views, searchValue]);

  return (
    <Modal
      bodyStyle={{ padding: 0 }}
      width={960}
      visible={visible}
      okText="Explore"
      onOk={goToExplore}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      closable={false}
      destroyOnClose
      afterClose={() => reset()}
    >
      <Row wrap={false} style={{ height: '70vh' }}>
        <Col
          span={7}
          className="p-3 d-flex flex-column border-r border-gray-4"
          style={{ height: '100%' }}
        >
          <Input
            prefix={<SearchOutlined className="gray-6" />}
            placeholder="Search"
            onInput={search}
          />
          <div className="mt-3 scrollable-y">
            <StyledMenu mode="inline" items={menu} onClick={clickMenu} />
          </div>
        </Col>
        <Col span={17} className="d-flex flex-column">
          {selectedItem ? (
            <>
              <h4 className="px-4 py-3 mb-0 border-b border-gray-4">
                {selectedItem.name}
              </h4>
              <div className="py-3 px-4 scrollable-y">
                {selectedItem.nodeType === NODE_TYPE.MODEL && (
                  <ModelMetadata {...selectedItem} />
                )}
                {selectedItem.nodeType === NODE_TYPE.METRIC && (
                  <MetricMetadata {...selectedItem} />
                )}
                {selectedItem.nodeType === NODE_TYPE.VIEW && (
                  <ViewMetadata {...selectedItem} />
                )}
              </div>
            </>
          ) : (
            <div
              className="d-flex align-center justify-center"
              style={{ height: '100%' }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No Selected Data"
              />
            </div>
          )}
        </Col>
      </Row>
    </Modal>
  );
}
