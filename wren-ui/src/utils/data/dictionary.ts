import { JOIN_TYPE } from '@/utils/enum';

const DefaultText = 'Unknown';

export const getJoinTypeText = (type) =>
  ({
    [JOIN_TYPE.MANY_TO_ONE]: 'Many-to-one',
    [JOIN_TYPE.ONE_TO_MANY]: 'One-to-many',
    [JOIN_TYPE.ONE_TO_ONE]: 'One-to-one',
  })[type] || DefaultText;
