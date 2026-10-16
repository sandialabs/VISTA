import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { eventPoint, nodeIdsWithinBounds } from './workflowGraph';
import { initialWorkflowGraphState, workflowGraphReducer } from './workflowGraphReducer';

// Pointer events also synthesize mouse events; handle only the pointer variant when supported.
function shouldIgnoreMouseFallback(event) {
  return event.type?.startsWith('mouse') && typeof window !== 'undefined' && Boolean(window.PointerEvent);
}

function useNodeDragHandlers(dispatch, stateRef) {
  const beginNodeDrag = useCallback((event, node) => {
    if (shouldIgnoreMouseFallback(event)) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    dispatch({ type: 'startDrag', node, point: eventPoint(event) });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  }, [dispatch]);

  const moveNodeDrag = useCallback((event) => {
    if (shouldIgnoreMouseFallback(event)) return;
    dispatch({ type: 'moveDrag', point: eventPoint(event) });
  }, [dispatch]);

  const endNodeDrag = useCallback((event) => {
    if (shouldIgnoreMouseFallback(event) || !stateRef.current.drag) return;
    dispatch({ type: 'endDrag' });
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [dispatch, stateRef]);

  return { beginNodeDrag, moveNodeDrag, endNodeDrag };
}

// Owns the Analyze workflow graph: nodes, node selection, and node dragging.
export default function useWorkflowGraph() {
  const [state, dispatch] = useReducer(workflowGraphReducer, initialWorkflowGraphState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const dragHandlers = useNodeDragHandlers(dispatch, stateRef);

  const clickNode = useCallback((node, event) => {
    const suppressed = stateRef.current.suppressClickId === node.id;
    dispatch({ type: 'clickNode', id: node.id, toggle: Boolean(event.ctrlKey || event.metaKey) });
    return !suppressed;
  }, []);

  const actions = useMemo(() => ({
    restore: (nodes) => dispatch({ type: 'restore', nodes }),
    addNode: (method, dropPoint, parameters) => dispatch({ type: 'addNode', method, dropPoint, parameters }),
    removeNodes: (ids) => dispatch({ type: 'removeNodes', ids }),
    updateParameter: (nodeId, name, value) => dispatch({ type: 'updateParameter', nodeId, name, value }),
    setSourceExample: (value) => dispatch({ type: 'setSourceExample', value }),
    applyDefaultCheckpoints: (checkpoints) => dispatch({ type: 'applyDefaultCheckpoints', checkpoints }),
    selectWithinBounds: (bounds) => dispatch({ type: 'selectNodes', ids: nodeIdsWithinBounds(stateRef.current.nodes, bounds) }),
    clearSelection: () => dispatch({ type: 'clearSelection' }),
  }), []);

  return { ...state, ...actions, ...dragHandlers, clickNode };
}
