import { Select } from 'antd';
import { useState } from 'react';
import styled from 'styled-components';

import { ProjectLanguage } from '@/types/project';
import { getLanguageText } from '@/utils/language';
import { RobotSVG } from '@/utils/svgs';

import type { DriverConfig, DriverPopoverDOM } from './utils';

export const RobotIcon = styled(RobotSVG)`
  width: 24px;
  height: 24px;
`;

export const GuidePreviewPanel = (props: {
  eyebrow: string;
  title: string;
  points: string[];
}) => {
  const { eyebrow, title, points } = props;

  return (
    <div
      style={{
        margin: '0 -16px 16px',
        padding: '18px 18px 16px',
        borderRadius: 14,
        border: '1px solid #e6e8ec',
        background:
          'linear-gradient(180deg, rgba(123, 85, 232, 0.08), rgba(123, 85, 232, 0.02))',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(123, 85, 232, 0.12)',
          color: '#6f42c1',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 22,
          fontWeight: 700,
          color: '#1f2937',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gap: 8,
        }}
      >
        {points.map((point) => (
          <div
            key={point}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#fff',
              border: '1px solid #edf0f4',
              color: '#344054',
              fontSize: 14,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#7b55e8',
                flex: '0 0 auto',
              }}
            />
            <span>{point}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const defaultGuideDriverConfig: DriverConfig = {
  progressText: '{{current}} / {{total}}',
  nextBtnText: '下一步',
  prevBtnText: '上一步',
  showButtons: ['next'],
  allowClose: false,
};

export const resetGuidePopoverStyle = (
  popoverDom: DriverPopoverDOM,
  width: number,
) => {
  const wrapper = popoverDom.wrapper;
  wrapper.style.maxWidth = 'none';
  wrapper.style.width = `${width}px`;
};

export const LanguageSwitcher = (props: { defaultValue: ProjectLanguage }) => {
  const [value, setValue] = useState(props.defaultValue);
  const languageOptions = Object.keys(ProjectLanguage).map((key) => ({
    label: getLanguageText(key as ProjectLanguage),
    value: key,
  }));

  return (
    <>
      <label className="d-block mb-2">知识库语言</label>
      <Select
        showSearch
        style={{ width: '100%' }}
        options={languageOptions}
        getPopupContainer={(trigger) => trigger.parentElement}
        onChange={(nextValue) => setValue(nextValue as ProjectLanguage)}
        value={value}
      />
      <input name="language" type="hidden" value={value} />
    </>
  );
};
