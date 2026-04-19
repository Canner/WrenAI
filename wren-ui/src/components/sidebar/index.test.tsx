import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from './index';
import { Path } from '@/utils/enum';

const mockUseRouter = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('./Home', () => ({
  __esModule: true,
  default: () => <div>HomeSidebar</div>,
}));

jest.mock('./Modeling', () => ({
  __esModule: true,
  default: () => <div>ModelingSidebar</div>,
}));

jest.mock('./Knowledge', () => ({
  __esModule: true,
  default: () => <div>KnowledgeSidebar</div>,
}));

jest.mock('./APIManagement', () => ({
  __esModule: true,
  default: () => <div>APIManagementSidebar</div>,
}));

jest.mock('@/components/learning', () => ({
  __esModule: true,
  default: () => <div>LearningSection</div>,
}));

describe('Sidebar route selection', () => {
  const baseProps = {
    data: { models: [], views: [], relations: [] } as any,
    onOpenModelDrawer: jest.fn(),
    onSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modeling sidebar for the legacy /modeling route', () => {
    mockUseRouter.mockReturnValue({
      pathname: Path.Modeling,
      query: {},
    });

    const html = renderToStaticMarkup(<Sidebar {...baseProps} />);

    expect(html).toContain('ModelingSidebar');
  });

  it('renders modeling sidebar for the knowledge workbench modeling section', () => {
    mockUseRouter.mockReturnValue({
      pathname: Path.Knowledge,
      query: { section: 'modeling' },
    });

    const html = renderToStaticMarkup(<Sidebar {...baseProps} />);

    expect(html).toContain('ModelingSidebar');
  });

  it('keeps the knowledge sidebar for non-modeling knowledge workbench sections', () => {
    mockUseRouter.mockReturnValue({
      pathname: Path.Knowledge,
      query: { section: 'overview' },
    });

    const html = renderToStaticMarkup(<Sidebar {...baseProps} />);

    expect(html).toContain('KnowledgeSidebar');
    expect(html).not.toContain('ModelingSidebar');
  });
});
