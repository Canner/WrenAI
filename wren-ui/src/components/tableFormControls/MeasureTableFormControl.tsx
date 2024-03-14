import { useMemo } from 'react';
import { makeTableFormControl } from './base';
import AddMeasureFieldModal, {
  MeasureFieldValue,
} from '@/components/modals/AddMeasureFieldModal';
import { getMeasureFieldTableColumns } from '@/components/table/MeasureFieldTable';

export type MeasureTableValue = MeasureFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddMeasureFieldModal);

export default function MeasureTableFormControl(props: Props) {
  const columns = useMemo(getMeasureFieldTableColumns, [props.value]);
  return <TableFormControl {...props} columns={columns} />;
}
