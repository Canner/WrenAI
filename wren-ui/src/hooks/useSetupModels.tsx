import { useState } from 'react';
import { SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import { SelectedSourceTables } from '@/components/pages/setup/CreateModels';

export default function useSetupModels() {
  const [stepKey, setStepKey] = useState(SETUP.SELECT_MODELS);
  const [selectedModels, setSelectedModels] = useState<any | undefined>(
    undefined,
  );

  const router = useRouter();

  const submitModels = async (_models: SelectedSourceTables) => {
    // TODO: implement submitModels API
    router.push('/setup/relations');
  };

  const onBack = () => {
    if (stepKey === SETUP.CREATE_MODELS) {
      setStepKey(SETUP.SELECT_MODELS);
    } else {
      router.push('/setup/connection');
    }
  };

  const onNext = (data?: {
    selectedModels: string[];
    models: SelectedSourceTables;
  }) => {
    if (stepKey === SETUP.SELECT_MODELS) {
      setSelectedModels(data.selectedModels);
      setStepKey(SETUP.CREATE_MODELS);
    }

    if (stepKey === SETUP.CREATE_MODELS) {
      submitModels(data.models);
    }
  };

  return {
    stepKey,
    selectedModels,
    tables,
    onBack,
    onNext,
  };
}

// TODO: remove it when connecting to backend
const tables = [
  {
    id: 'a3e9aba0-c1a7-43bb-8bae-da65256ec5a3',
    sqlName: 'customer',
    displayName: 'customer',
    columns: [
      {
        name: 'address',
        type: 'VARCHAR',
      },
      {
        name: 'custkey',
        type: 'BIGINT',
      },
      {
        name: 'name',
        type: 'VARCHAR',
      },
      {
        name: 'nationkey',
        type: 'BIGINT',
      },
    ],
  },
  {
    id: '3f74ab82-aa22-476c-9577-273db3d1f75c',
    sqlName: 'lineitem',
    displayName: 'lineitem',
    columns: [
      {
        name: 'comment',
        type: 'VARCHAR',
      },
      {
        name: 'commitdate',
        type: 'DATE',
      },
      {
        name: 'discount',
        type: 'DOUBLE',
      },
      {
        name: 'extendedprice',
        type: 'DOUBLE',
      },
      {
        name: 'linenumber',
        type: 'INTEGER',
      },
      {
        name: 'linestatus',
        type: 'VARCHAR',
      },
      {
        name: 'orderkey',
        type: 'BIGINT',
      },
      {
        name: 'partkey',
        type: 'BIGINT',
      },
      {
        name: 'quantity',
        type: 'DOUBLE',
      },
      {
        name: 'receiptdate',
        type: 'DATE',
      },
      {
        name: 'returnflag',
        type: 'VARCHAR',
      },
      {
        name: 'shipdate',
        type: 'DATE',
      },
      {
        name: 'shipinstruct',
        type: 'VARCHAR',
      },
      {
        name: 'shipmode',
        type: 'VARCHAR',
      },
      {
        name: 'suppkey',
        type: 'BIGINT',
      },
      {
        name: 'tax',
        type: 'DOUBLE',
      },
    ],
  },
  {
    id: 'a6339b68-0ffb-4268-8cfd-68b8206a852f',
    sqlName: 'nation',
    displayName: 'nation',
    columns: [
      {
        name: 'comment',
        type: 'VARCHAR',
      },
      {
        name: 'name',
        type: 'VARCHAR',
      },
      {
        name: 'nationkey',
        type: 'BIGINT',
      },
      {
        name: 'regionkey',
        type: 'BIGINT',
      },
    ],
  },
  {
    id: '1e6b4ca6-c1ba-43de-ad5c-dcd203e5fed2',
    sqlName: 'orders',
    displayName: 'orders',
    columns: [
      {
        name: 'clerk',
        type: 'VARCHAR',
      },
      {
        name: 'comment',
        type: 'VARCHAR',
      },
      {
        name: 'custkey',
        type: 'BIGINT',
      },
      {
        name: 'orderdate',
        type: 'DATE',
      },
      {
        name: 'orderkey',
        type: 'BIGINT',
      },
      {
        name: 'orderpriority',
        type: 'VARCHAR',
      },
      {
        name: 'orderstatus',
        type: 'VARCHAR',
      },
      {
        name: 'shippriority',
        type: 'INTEGER',
      },
      {
        name: 'totalprice',
        type: 'DOUBLE',
      },
    ],
  },
];
