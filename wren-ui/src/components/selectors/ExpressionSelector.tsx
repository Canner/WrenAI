import { Typography } from 'antd';
import DescriptiveSelector, { Option } from './DescriptiveSelector';
import React from 'react';

export type ExpressionOption = Option<{
  expression: string;
  description: string;
}>;

interface Props extends React.ComponentProps<typeof DescriptiveSelector> {
  options: ExpressionOption[];
}

export default function ExpressionSelector(props: Props) {
  const { options, ...restProps } = props;
  return (
    <DescriptiveSelector
      placeholder="Select an expression"
      options={options}
      {...restProps}
      descriptiveContentRender={(content) => {
        return (
          <>
            <div className="mb-1">{content?.description || '-'}</div>
            {content?.expression && (
              <Typography.Text className="mb-1" code>
                {content.expression}
              </Typography.Text>
            )}
          </>
        );
      }}
    />
  );
}
