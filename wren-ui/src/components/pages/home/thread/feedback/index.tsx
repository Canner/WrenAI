import { createContext, useContext, useMemo, useState } from 'react';
import ReferenceSideFloat from './ReferenceSideFloat';
import { ReferenceTypes } from './utils';

type ContextProps = {
  references: any[];
} | null;

export const FeedbackContext = createContext<ContextProps>({
  references: [],
});

export const useFeedbackContext = () => {
  return useContext(FeedbackContext);
};

interface Props {
  headerSlot: React.ReactNode;
  bodySlot: React.ReactNode;
}

const data = [
  {
    id: '1',
    type: ReferenceTypes.FIELD,
    title:
      "Selects the 'City' column from the 'customer_data' dataset to display the city name.",
    referenceNum: 1,
  },
  {
    id: '2',
    type: ReferenceTypes.FIELD,
    title: 'Reference 2',
    referenceNum: 2,
  },
  {
    id: '3',
    type: ReferenceTypes.QUERY_FROM,
    title: 'Reference 3',
    referenceNum: 3,
  },
  {
    id: '4',
    type: ReferenceTypes.QUERY_FROM,
    title: 'Reference 4',
    referenceNum: 4,
  },
  {
    id: '5',
    type: ReferenceTypes.FILTER,
    title: 'Reference 4',
    referenceNum: 4,
  },
  {
    id: '6',
    type: ReferenceTypes.SORTING,
    title: 'Reference 4',
    referenceNum: 4,
  },
  {
    id: '7',
    type: ReferenceTypes.GROUP_BY,
    title: 'Reference 4',
    referenceNum: 4,
  },
];

export default function Feedback(props: Props) {
  const { headerSlot, bodySlot } = props;

  const [correctionPrompts, setCorrectionPrompts] = useState({});

  const saveCorrectionPrompt = (id: string, value: string) => {
    setCorrectionPrompts({ ...correctionPrompts, [id]: value });
  };

  const references = useMemo(() => {
    return data.map((item) => ({
      ...item,
      correctionPrompt: correctionPrompts[item.id],
    }));
  }, [data, correctionPrompts]);

  const contextValue = {
    references,
    saveCorrectionPrompt,
  };

  return (
    <FeedbackContext.Provider value={contextValue}>
      <div>{headerSlot}</div>
      <div className="d-flex">
        {bodySlot}
        <div className="flex-shrink-0 pl-5">
          <ReferenceSideFloat
            references={references}
            saveCorrectionPrompt={saveCorrectionPrompt}
          />
        </div>
      </div>
    </FeedbackContext.Provider>
  );
}
