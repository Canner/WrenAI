import { COLUMN } from '@/components/table/BaseTable';
import { makeTableFormControl } from './base';
import AddMeasureFieldModal, {
  MeasureFieldValue,
} from '@/components/modals/AddMeasureFieldModal';

export type MeasureTableValue = MeasureFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddMeasureFieldModal);

export default function MeasureTableFormControl(props: Props) {
  return (
    <TableFormControl
      {...props}
      columns={[COLUMN.DISPLAY_NAME, COLUMN.REFERENCE_NAME, COLUMN.DESCRIPTION]}
    />
  );
}
