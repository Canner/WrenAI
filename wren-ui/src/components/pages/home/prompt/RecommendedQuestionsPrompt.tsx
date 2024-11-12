import { useState } from 'react';
import { Space, Button } from 'antd';
import { Logo } from '@/components/Logo';
import PromptCategorySection from './PromptCategorySection';

export default function RecommendedQuestionsPrompt(props) {
  const { onSelect, recommendedQuestions, buttonProps } = props;

  const [expandedCategory, setExpandedCategory] = useState(null);

  const onHandleToggle = (category) => {
    setExpandedCategory((prev) => (prev === category ? null : category));
  };

  return (
    <div className="bg-gray-2 px-10 py-6">
      <div className="d-flex align-center mb-3 justify-space-between">
        <Logo size={24} color="var(--gray-8)" />
        <div className="text-md text-medium gray-8 mx-3">
          Know more about your data.
        </div>
        <div className="text-medium gray-7">
          Try asking some of the following questions
        </div>
        <Button className="ml-3" {...buttonProps} />
      </div>
      <Space
        style={{ width: 680 }}
        className="gray-8"
        direction="vertical"
        size={[0, 16]}
      >
        {recommendedQuestions.map((category, index) => (
          <PromptCategorySection
            key={`${category.label}-${index}`}
            category={category}
            expandedCategory={expandedCategory}
            onSelect={onSelect}
            onHandleToggle={onHandleToggle}
          />
        ))}
      </Space>
    </div>
  );
}
