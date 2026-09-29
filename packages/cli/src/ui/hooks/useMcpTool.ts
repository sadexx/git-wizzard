import { useCallback, useEffect, useState } from 'react';
import type { AppError, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';

export type ToolState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly message: string };

/** Run an MCP tool call on mount (and on `reload`), tracking loading/success/error. */
export function useMcpTool<T>(run: () => Promise<Result<T, AppError>>): { state: ToolState<T>; reload: () => void } {
  const [state, setState] = useState<ToolState<T>>({ status: 'loading' });
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    run()
      .then((result: Result<T, AppError>) => {
        setState(
          result.ok
            ? { status: 'success', data: result.value }
            : { status: 'error', message: renderError(result.error) },
        );
      })
      .catch((error: unknown) => {
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { state, reload };
}
