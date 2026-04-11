/**
 * Shared hooks – useAbortOnUnmount.
 *
 * Returns an AbortSignal that aborts automatically when the component unmounts.
 */
import { useEffect, useRef } from "react";

export function useAbortOnUnmount(): AbortSignal {
  const ref = useRef<AbortController>(new AbortController());

  useEffect(() => {
    return () => {
      ref.current.abort();
    };
  }, []);

  return ref.current.signal;
}
