import styled from 'styled-components';
import NovaBrandMark from './NovaBrandMark';

type Props = {
  tone?: 'dark' | 'light';
  markSize?: number;
  textSize?: number;
  gap?: number;
  className?: string;
};

const Root = styled.span<{ $gap: number }>`
  display: inline-flex;
  align-items: center;
  gap: ${(props) => `${props.$gap}px`};
  min-width: 0;
`;

const Text = styled.span<{
  $tone: 'dark' | 'light';
  $textSize: number;
}>`
  font-size: ${(props) => `${props.$textSize}px`};
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: ${(props) => (props.$tone === 'light' ? '#ffffff' : '#111827')};
`;

export default function NovaWordmark({
  tone = 'dark',
  markSize = 24,
  textSize = 18,
  gap = 10,
  className,
}: Props) {
  return (
    <Root className={className} $gap={gap}>
      <NovaBrandMark size={markSize} />
      <Text $tone={tone} $textSize={textSize}>
        Nova
      </Text>
    </Root>
  );
}
