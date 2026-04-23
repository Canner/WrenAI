import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { isEmpty } from 'lodash';
import { Alert, Button, Popover, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { compile, type Config, type TopLevelSpec } from 'vega-lite';
import type { EmbedOptions, Result } from 'vega-embed';
import { chartVegaConfig } from './config';
import {
  normalizeChartDomDimension,
  normalizeChartRenderDimension,
  prepareChartSpecForRender,
  resolvePreferredRenderer,
} from './render';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import PushPinOutlined from '@ant-design/icons/PushpinOutlined';
import ErrorCollapse from '@/components/ErrorCollapse';

const embedOptions: EmbedOptions = {
  mode: 'vega',
  renderer: 'svg',
  tooltip: { theme: 'custom' },
  actions: {
    export: true,
    editor: false,
  },
};

const COMPILED_SPEC_CACHE_VERSION = 'compiled-chart-spec-v1';
const MAX_COMPILED_SPEC_CACHE_ENTRIES = 100;
const compiledChartSpecCache = new Map<string, Record<string, any>>();

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildDataSignature = (spec: TopLevelSpec) => {
  const values = Array.isArray((spec as any)?.data?.values)
    ? ((spec as any).data.values as Record<string, unknown>[])
    : [];
  let hash = 2166136261;
  values.forEach((row) => {
    const rowText = JSON.stringify(row);
    for (let index = 0; index < rowText.length; index += 1) {
      hash ^= rowText.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  });

  return `${values.length}:${(hash >>> 0).toString(36)}`;
};

const buildSpecSignature = (spec: TopLevelSpec) => {
  const specWithoutValues =
    spec && typeof spec === 'object'
      ? {
          ...((spec as unknown as Record<string, unknown>) || {}),
          data: {
            ...(((spec as any).data as Record<string, unknown>) || {}),
            values: '__omitted__',
          },
        }
      : spec;
  return hashString(JSON.stringify(specWithoutValues));
};

const buildCompiledChartSpecCacheKey = ({
  spec,
  config,
  cacheKey,
}: {
  spec: TopLevelSpec;
  config?: Config;
  cacheKey?: string;
}) =>
  [
    COMPILED_SPEC_CACHE_VERSION,
    cacheKey || 'anonymous',
    buildSpecSignature(spec),
    buildDataSignature(spec),
    hashString(JSON.stringify(config || null)),
  ].join(':');

const touchCompiledChartSpecCache = (
  key: string,
  value: Record<string, any>,
) => {
  if (compiledChartSpecCache.has(key)) {
    compiledChartSpecCache.delete(key);
  }
  compiledChartSpecCache.set(key, value);
  if (compiledChartSpecCache.size > MAX_COMPILED_SPEC_CACHE_ENTRIES) {
    const oldestKey = compiledChartSpecCache.keys().next().value;
    if (oldestKey) {
      compiledChartSpecCache.delete(oldestKey);
    }
  }
};

const compileChartSpecWithCache = ({
  spec,
  config,
  cacheKey,
}: {
  spec: TopLevelSpec;
  config?: Config;
  cacheKey?: string;
}) => {
  const compiledCacheKey = buildCompiledChartSpecCacheKey({
    spec,
    config,
    cacheKey,
  });
  const cached = compiledChartSpecCache.get(compiledCacheKey);
  if (cached) {
    touchCompiledChartSpecCache(compiledCacheKey, cached);
    return cached;
  }

  const compiled = compile(spec, { config }).spec as Record<string, any>;
  touchCompiledChartSpecCache(compiledCacheKey, compiled);
  return compiled;
};

interface VegaLiteProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  spec?: TopLevelSpec;
  values?: Record<string, any>[];
  autoFilter?: boolean;
  hideActions?: boolean;
  hideTitle?: boolean;
  hideLegend?: boolean;
  forceUpdate?: number;
  isPinned?: boolean;
  onReload?: () => void;
  onEdit?: () => void;
  hideReloadAction?: boolean;
  hideEditAction?: boolean;
  onPin?: () => void;
  pinDisabled?: boolean;
  pinButtonLabel?: string;
  pinPopoverContent?: ReactNode;
  pinPopoverOpen?: boolean;
  onPinPopoverOpenChange?: (open: boolean) => void;
  preferredRenderer?: 'svg' | 'canvas';
  cacheKey?: string;
  serverShaped?: boolean;
}

type ParsedError = {
  code: string;
  shortMessage: string;
  message: string;
  stacktrace: string[];
};

const normalizeError = (
  error: unknown,
): Pick<ParsedError, 'message' | 'stacktrace'> => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stacktrace: error.stack?.split('\n') || [],
    };
  }

  return {
    message: String(error),
    stacktrace: [],
  };
};

export default function Chart(props: VegaLiteProps) {
  const {
    className,
    spec,
    values,
    width = 600,
    height = 320,
    autoFilter,
    hideActions,
    hideTitle,
    hideLegend,
    forceUpdate,
    isPinned,
    onReload,
    onEdit,
    hideReloadAction,
    hideEditAction,
    onPin,
    pinDisabled,
    pinButtonLabel,
    pinPopoverContent,
    pinPopoverOpen,
    onPinPopoverOpenChange,
    preferredRenderer,
    cacheKey,
    serverShaped,
  } = props;

  const [donutInner, setDonutInner] = useState<number | false | undefined>(
    undefined,
  );
  const [parsedSpec, setParsedSpec] = useState<Record<string, any> | null>(
    null,
  );
  const [parsedError, setParsedError] = useState<ParsedError | null>(null);
  const [isShowTopCategories, setIsShowTopCategories] = useState(false);
  const $view = useRef<Result | null>(null);
  const $container = useRef<HTMLDivElement>(null);
  const renderWidth = normalizeChartRenderDimension(width);
  const renderHeight = normalizeChartRenderDimension(height);
  const domWidth = normalizeChartDomDimension(width);
  const domHeight = normalizeChartDomDimension(height);

  useEffect(() => {
    if (!spec || !values) return;
    try {
      const renderSpec = prepareChartSpecForRender({
        spec,
        values,
        options: {
          width: renderWidth,
          height: renderHeight,
          donutInner,
          autoFilter,
          isShowTopCategories,
          hideLegend,
          hideTitle,
          serverShaped,
        },
      });
      if (!renderSpec && !autoFilter && !isShowTopCategories) {
        setParsedSpec(null);
        setParsedError(null);
        return;
      }
      const chartSpec = renderSpec;
      if (!chartSpec) {
        setParsedSpec(null);
      } else {
        const isDataEmpty = isEmpty(
          (
            chartSpec.data as {
              values?: Record<string, any>[];
            } | null
          )?.values,
        );
        if (isDataEmpty) {
          setParsedSpec(null);
          setParsedError(null);
          return;
        }
        const compiled = compileChartSpecWithCache({
          spec: chartSpec,
          config: chartVegaConfig,
          cacheKey,
        });
        setParsedSpec(compiled);
      }
      setParsedError(null);
    } catch (error) {
      const errorPayload = normalizeError(error);
      setParsedError({
        code: 'CLIENT_PARSE_ERROR',
        shortMessage: 'Failed to render chart visualization',
        message: errorPayload.message,
        stacktrace: errorPayload.stacktrace,
      });
    }
    return () => {
      setParsedSpec(null);
      setParsedError(null);
    };
  }, [
    autoFilter,
    donutInner,
    forceUpdate,
    hideLegend,
    hideTitle,
    renderHeight,
    isShowTopCategories,
    spec,
    cacheKey,
    serverShaped,
    values,
    renderWidth,
  ]);

  // initial vega view
  useEffect(() => {
    let cancelled = false;

    if ($container.current && parsedSpec) {
      const renderer = resolvePreferredRenderer({
        spec,
        values,
        isPinned,
        preferredRenderer,
      });
      void import('vega-embed')
        .then(({ default: embed }) =>
          embed($container.current!, parsedSpec, {
            ...embedOptions,
            renderer,
          }),
        )
        .then((view) => {
          if (cancelled) {
            view.finalize();
            return;
          }

          $view.current = view;
        })
        .catch((error) => {
          const errorPayload = normalizeError(error);
          setParsedError({
            code: 'CLIENT_RENDER_ERROR',
            shortMessage: 'Failed to render chart visualization',
            message: errorPayload.message,
            stacktrace: errorPayload.stacktrace,
          });
        });
    }

    return () => {
      cancelled = true;
      if ($view.current) $view.current.finalize();
    };
  }, [forceUpdate, isPinned, parsedSpec, preferredRenderer, spec, values]);

  useEffect(() => {
    if ($container.current) {
      setDonutInner($container.current.clientHeight * 0.15);
    }
  }, [forceUpdate]);

  const onShowTopCategories = () => {
    setIsShowTopCategories((previous) => !previous);
  };

  const getChartContent = () => {
    if (!values || values.length === 0) return <div>暂无可用数据</div>;

    if (parsedError) {
      return (
        <div
          className={clsx({ 'mx-4 mt-12': !isPinned })}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Alert
            showIcon
            type="error"
            title={parsedError.shortMessage}
            description={
              <ErrorCollapse message={parsedError.message} defaultActive />
            }
          />
        </div>
      );
    }

    if (parsedSpec === null) {
      return (
        <Alert
          className="mt-12 mb-4 mx-4"
          title={
            <div className="d-flex align-center justify-space-between">
              <div>
                There are too many categories to display effectively. Click
                'Show top 25' to view the top results, or ask a follow-up
                question to focus on a specific group or filter results.
              </div>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={onShowTopCategories}
              >
                Show top 25
              </Button>
            </div>
          }
          type="warning"
        />
      );
    }

    return (
      <div style={{ width: domWidth, height: domHeight }} ref={$container} />
    );
  };

  const shouldShowReloadAction = Boolean(onReload) && !hideReloadAction;
  const shouldShowEditAction = Boolean(onEdit) && !hideEditAction;
  const shouldShowPinAction = !!onPin || !!pinPopoverContent;
  const isAdditionalShow =
    shouldShowReloadAction || shouldShowEditAction || shouldShowPinAction;
  const resolvedPinButtonTitle = pinButtonLabel || 'Pin chart to dashboard';
  const pinButton = (
    <button
      className={clsx({
        'adm-chart-additional__pin-button': Boolean(pinButtonLabel),
      })}
      aria-label={resolvedPinButtonTitle}
      title={resolvedPinButtonTitle}
      disabled={pinDisabled}
      onClick={pinPopoverContent ? undefined : onPin}
    >
      <PushPinOutlined />
      {pinButtonLabel ? <span>{pinButtonLabel}</span> : null}
    </button>
  );

  return (
    <div
      className={clsx(
        'adm-chart',
        { 'adm-chart--no-actions': hideActions },
        className,
      )}
      style={{ width: domWidth }}
    >
      {isAdditionalShow && (
        <div className="adm-chart-additional d-flex justify-content-between align-center">
          {shouldShowReloadAction && (
            <Tooltip title="Regenerate chart">
              <button
                aria-label="Regenerate chart"
                title="Regenerate chart"
                onClick={onReload}
              >
                <ReloadOutlined />
              </button>
            </Tooltip>
          )}
          {shouldShowEditAction && (
            <Tooltip title="Edit chart">
              <button
                aria-label="Edit chart"
                title="Edit chart"
                onClick={onEdit}
              >
                <EditOutlined />
              </button>
            </Tooltip>
          )}
          {shouldShowPinAction &&
            (pinPopoverContent ? (
              <Popover
                trigger="click"
                placement="bottomRight"
                content={pinPopoverContent}
                open={pinPopoverOpen}
                onOpenChange={onPinPopoverOpenChange}
              >
                {pinButton}
              </Popover>
            ) : (
              <Tooltip title={resolvedPinButtonTitle}>{pinButton}</Tooltip>
            ))}
        </div>
      )}
      {getChartContent()}
    </div>
  );
}
