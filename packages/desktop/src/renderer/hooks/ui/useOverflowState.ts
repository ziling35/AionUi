import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const isElementOverflowing = (element: HTMLElement): boolean =>
  element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;

export const useOverflowState = <ElementType extends HTMLElement>() => {
  const ref = useRef<ElementType>(null);
  const [overflowing, setOverflowing] = useState(false);

  const updateOverflowState = useCallback(() => {
    const element = ref.current;
    const nextOverflowing = element ? isElementOverflowing(element) : false;
    setOverflowing((current) => (current === nextOverflowing ? current : nextOverflowing));
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    updateOverflowState();
    if (!element) return;

    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateOverflowState);
    resizeObserver?.observe(element);
    if (element.parentElement) {
      resizeObserver?.observe(element.parentElement);
    }

    window.addEventListener('resize', updateOverflowState);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateOverflowState);
    };
  }, [updateOverflowState]);

  return { ref, overflowing, updateOverflowState };
};
