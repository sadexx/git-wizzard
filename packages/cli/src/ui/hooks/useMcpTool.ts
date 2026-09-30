import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError, Result } from '@git-wizzard/shared';
import { renderError } from '#errors.js';

export type ToolState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly message: string };

/** Run an MCP tool call on mount (and on `reload`), tracking loading/success/error. */
export function useMcpTool<T>(run: () => Promise<Result<T, AppError>>): { state: ToolState<T>; reload: () => void } {
  const [state, setState] = useState<ToolState<T>>({ status: 'loading' });
  // Only the latest call may settle: an older, slower one must not overwrite a newer result.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const call = ++latest.current;
    const settle = (next: ToolState<T>): void => {
      if (call === latest.current) setState(next);
    };
    setState({ status: 'loading' });
    run()
      .then((result: Result<T, AppError>) => {
        settle(
          result.ok
            ? { status: 'success', data: result.value }
            : { status: 'error', message: renderError(result.error) },
        );
      })
      .catch((error: unknown) => {
        settle({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { state, reload };
}
