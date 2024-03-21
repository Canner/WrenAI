import { COLUMN } from '@/components/table/BaseTable';
import { makeTableFormControl } from './base';
import AddRelationModal, {
  RelationFieldValue,
} from '@/components/modals/AddRelationModal';

export type RelationTableValue = RelationFieldValue[];

type Props = Omit<React.ComponentProps<typeof TableFormControl>, 'columns'>;

const TableFormControl = makeTableFormControl(AddRelationModal);

export default function RelationTableFormControl(props: Props) {
  return (
    <TableFormControl
      {...props}
      // Relation has metadata directly in table form control
      columns={[
        COLUMN.REFERENCE_NAME,
        COLUMN.RELATION_FROM,
        COLUMN.RELATION_TO,
        COLUMN.RELATION,
        COLUMN.DESCRIPTION,
      ]}
    />
  );
}
