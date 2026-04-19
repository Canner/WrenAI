import { Button, Form, Typography } from 'antd';
import styled from 'styled-components';

const { Paragraph, Title } = Typography;

export const Page = styled.main`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(20px, 4vw, 32px);
  background: radial-gradient(
      circle at 22% 42%,
      rgba(123, 85, 232, 0.06),
      transparent 28%
    ),
    linear-gradient(180deg, #f5f6fb 0%, #f2f4fa 100%);
`;

export const Layout = styled.section`
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 560px) 388px;
  gap: 44px;
  justify-content: center;
  align-items: center;
  transform: translateY(-10px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    gap: 20px;
    max-width: 420px;
    transform: none;
  }
`;

export const Intro = styled.div`
  max-width: 680px;

  @media (max-width: 980px) {
    max-width: none;
    text-align: center;
  }
`;

export const IntroBody = styled.div`
  width: min(100%, 540px);
`;

export const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;

  @media (max-width: 980px) {
    justify-content: center;
    margin-bottom: 16px;
  }
`;

export const BrandMark = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 10px 22px rgba(79, 131, 255, 0.18));
`;

export const BrandTitle = styled.div`
  color: #1f2638;
  font-size: 27px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
`;

export const IntroTitle = styled(Title)`
  &.ant-typography {
    margin: 0 0 12px;
    color: #151d31;
    font-size: 40px;
    line-height: 1.18;
    letter-spacing: -0.02em;
    max-width: 540px;
    text-wrap: balance;
  }

  @media (max-width: 980px) {
    &.ant-typography {
      margin-bottom: 10px;
      font-size: 32px;
      max-width: none;
    }
  }
`;

export const IntroCopy = styled(Paragraph)`
  &.ant-typography {
    margin: 0;
    color: #626b84;
    font-size: 15px;
    line-height: 1.75;
    max-width: 500px;
  }

  @media (max-width: 980px) {
    &.ant-typography {
      margin: 0 auto;
      font-size: 14px;
      max-width: 340px;
    }
  }
`;

export const IntroTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
  max-width: 540px;

  @media (max-width: 980px) {
    justify-content: center;
    margin-top: 16px;
    max-width: none;
  }
`;

export const IntroTag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(123, 85, 232, 0.12);
  background: rgba(123, 85, 232, 0.05);
  color: #665d87;
  font-size: 11px;
  line-height: 1;
`;

export const LoginCard = styled.div`
  background: #ffffff;
  border-radius: 18px;
  padding: 30px;
  border: 1px solid #e6e8ee;
  box-shadow: 0 18px 40px rgba(17, 24, 39, 0.065);

  @media (max-width: 980px) {
    padding: 26px 22px 22px;
  }
`;

export const CardHeader = styled.div`
  margin-bottom: 20px;
`;

export const CardTitle = styled.div`
  color: #161d31;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.2;
`;

export const CardCopy = styled.p`
  margin: 6px 0 0;
  color: #697287;
  font-size: 13px;
  line-height: 1.6;
`;

export const StyledForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 12px;
  }

  .ant-form-item-label {
    padding-bottom: 6px;
  }

  .ant-form-item-label > label {
    color: #58607a;
    font-size: 13px;
    font-weight: 600;
  }

  .ant-input,
  .ant-input-affix-wrapper {
    height: 50px;
    border-radius: 12px;
    border-color: #dfe3eb;
    background: #fbfcfe;
    box-shadow: none;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease;
  }

  .ant-input {
    padding: 0 14px;
  }

  .ant-input-affix-wrapper {
    padding: 0 14px;
  }

  .ant-select-selector {
    min-height: 48px !important;
    border-radius: 10px !important;
    border-color: #dfe3eb !important;
    box-shadow: none !important;
    padding: 0 14px !important;
    display: flex;
    align-items: center;
  }

  .ant-select-selection-search-input,
  .ant-select-selection-item,
  .ant-select-selection-placeholder {
    line-height: 46px !important;
  }

  .ant-input-affix-wrapper > input.ant-input {
    height: 100%;
    padding: 0;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  .ant-input-affix-wrapper .ant-input-password-icon {
    color: #99a1b3;
  }

  .ant-input::placeholder,
  .ant-input-affix-wrapper input::placeholder {
    color: #a1a9bb;
  }

  .ant-input:hover,
  .ant-input-affix-wrapper:hover {
    border-color: #cfd6e6;
    background: #ffffff;
  }

  .ant-input:focus,
  .ant-input-focused,
  .ant-select-focused .ant-select-selector,
  .ant-input-affix-wrapper-focused,
  .ant-input-affix-wrapper:focus-within {
    border-color: #7b55e8;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(123, 85, 232, 0.1);
  }
`;

export const SubmitButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 48px;
    margin-top: 16px;
    border: none;
    border-radius: 14px;
    background: #7b55e8;
    color: #fff;
    font-weight: 700;
    font-size: 16px;
    box-shadow: 0 12px 24px rgba(123, 85, 232, 0.24);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease;
  }

  &.ant-btn > span {
    letter-spacing: 0.02em;
  }

  &.ant-btn.ant-btn-two-chinese-chars > span {
    margin-right: 0;
    letter-spacing: 0.02em;
  }

  &.ant-btn:hover,
  &.ant-btn:focus {
    background: #6f4ce6;
    color: #fff;
    transform: translateY(-1px);
    box-shadow: 0 16px 26px rgba(123, 85, 232, 0.26);
  }

  &.ant-btn:active {
    background: #6542d8;
    color: #fff;
    transform: translateY(0);
  }
`;

export const RememberRow = styled.div`
  margin-top: -2px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #5f6880;

  .remember-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  @media (max-width: 980px) {
    margin-bottom: 8px;
  }
`;

export const SecondaryTextButton = styled.button`
  padding: 0;
  border: none;
  background: transparent;
  color: #6e778f;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  transition: color 0.18s ease;

  &:hover {
    color: #5942d8;
  }

  &:disabled {
    color: #9aa3b6;
    cursor: not-allowed;
  }
`;
