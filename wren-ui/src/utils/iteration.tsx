interface Props {
  [key: string]: any;
  data: any[];
  // by default it will use item['key'] as keyIndex unless specifying keyIndex
  keyIndex?: string | ((item: any) => string);
}

export type IterableComponent<T = any> = {
  data: T[];
  index: number;
  key: string;
} & T;

export const makeIterable = (Template: React.FC<IterableComponent<any>>) => {
  const Iterator = (props: Props) => {
    const { data, keyIndex = 'key', ...restProps } = props;
    const result = data.map((item, index) => {
      const key =
        typeof keyIndex === 'function' ? keyIndex(item) : item[keyIndex];
      return (
        <Template
          data={data}
          index={index}
          key={`${index}-${key}`}
          {...restProps}
          {...item}
        />
      );
    });
    return <>{result}</>;
  };

  return Iterator;
};
