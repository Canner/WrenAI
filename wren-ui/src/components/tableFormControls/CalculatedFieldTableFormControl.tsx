import { COLUMN } from '@/components/table/BaseTable';
import { makeTableFormControl } from './base';
import AddCalculatedFieldModal, {
  CalculatedFieldValue,
} from '@/components/modals/AddCalculatedFieldModal';

export type CalculatedFieldTableValue = CalculatedFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddCalculatedFieldModal);

export default function CalculatedFieldTableFormControl(props: Props) {
  return (
    <TableFormControl
      {...props}
      columns={[
        COLUMN.DISPLAY_NAME,
        COLUMN.REFERENCE_NAME,
        COLUMN.EXPRESSION,
        COLUMN.DESCRIPTION,
      ]}
    />
  );
}
