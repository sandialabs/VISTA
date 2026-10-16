import React from 'react';

function AnalyzeGraphCanvas({
  status,
  exampleImageId,
  nodes,
  onValidate,
  onRunExample,
  onRun,
  onStop,
  graphRef,
  onDragOver,
  onDrop,
  onPointerDownMarquee,
  onPointerMoveMarquee,
  onPointerUpMarquee,
  graphBounds,
  edges,
  methodById,
  selectedNodeId,
  selectedNodeIds,
  graphDrag,
  onBeginNodeDrag,
  onMoveNodeDrag,
  onEndNodeDrag,
  onNodeClick,
  marquee,
}) {
  return (
    <main className="analyze-canvas-panel">
      <div className="analyze-canvas-toolbar">
        <div className="workbench-detail-actions">
          <button type="button" className="btn btn-secondary" disabled={status.loading} onClick={onValidate}>
            Validate
          </button>
          <button type="button" className="btn btn-secondary" disabled={status.loading || !exampleImageId || nodes.length === 0} onClick={onRunExample}>
            Run Example
          </button>
          <button type="button" className="btn btn-primary" disabled={status.loading || nodes.length === 0} onClick={onRun}>
            Run
          </button>
          <button type="button" className="btn btn-danger" disabled={!status.loading} onClick={onStop}>
            Stop
          </button>
        </div>
      </div>

      <div
        className="analyze-graph"
        data-testid="analyze-graph"
        ref={graphRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPointerDown={onPointerDownMarquee}
        onPointerMove={onPointerMoveMarquee}
        onPointerUp={onPointerUpMarquee}
        style={{
          '--analyze-graph-width': `${graphBounds.width}px`,
          '--analyze-graph-height': `${graphBounds.height}px`,
        }}
      >
        <div className="analyze-graph-surface">
        <svg
          className="analyze-edges"
          aria-hidden="true"
          width={graphBounds.width}
          height={graphBounds.height}
          viewBox={`0 0 ${graphBounds.width} ${graphBounds.height}`}
        >
          {edges.map((edge, index) => {
            const source = nodes.find((node) => node.id === edge.source_node);
            const target = nodes.find((node) => node.id === edge.target_node);
            if (!source || !target) return null;
            const x1 = source.x + 168;
            const y1 = source.y + 38;
            const x2 = target.x;
            const y2 = target.y + 38;
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.source_node}-${edge.target_node}-${index}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              />
            );
          })}
        </svg>
        {nodes.map((node, index) => {
          const method = methodById.get(node.method_id);
          return (
            <button
              key={node.id}
              type="button"
              className={`analyze-node ${(selectedNodeIds.includes(node.id) || selectedNodeId === node.id) ? 'selected' : ''} ${graphDrag?.id === node.id ? 'dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onBeginNodeDrag(event, node)}
              onPointerMove={onMoveNodeDrag}
              onPointerUp={onEndNodeDrag}
              onPointerCancel={onEndNodeDrag}
              onMouseDown={(event) => onBeginNodeDrag(event, node)}
              onMouseMove={onMoveNodeDrag}
              onMouseUp={onEndNodeDrag}
              onMouseLeave={onEndNodeDrag}
              onClick={(event) => onNodeClick(node, event)}
              aria-label={`Workflow block ${node.label}`}
              title="Drag to reposition this workflow block"
            >
              <span className="analyze-node-index">{index + 1}</span>
              <strong>{node.label}</strong>
              <small>{method?.category || 'Method'}</small>
            </button>
          );
        })}
        {marquee && <div className="analyze-selection-box" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
        </div>
      </div>
    </main>
  );
}

export default AnalyzeGraphCanvas;
