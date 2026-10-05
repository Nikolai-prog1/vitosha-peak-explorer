// Explicit ESM exports for Python's native browser import map. React's npm
// entry is CommonJS; bundling that entry alone only exposes a default export.
import React from "react";
export default React;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, use, useCallback, useContext, useDebugValue,
  useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect,
  useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
  useSyncExternalStore, useTransition, version,
} = React;
