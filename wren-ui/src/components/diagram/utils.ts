export const trimId = (id: string) => id.split('_')[0];

export const highlightEdges = (edgeIds: string[], highlight: boolean) => {
  return (edges: any) =>
    edges.map((edge: any) => {
      const selected = '_selected';
      const markerStart = edge.markerStart.replace(selected, '');
      const markerEnd = edge.markerEnd.replace(selected, '');
      return edgeIds.includes(edge.id)
        ? {
            ...edge,
            data: { ...edge.data, highlight },
            markerStart: markerStart + selected,
            markerEnd: markerEnd + selected,
          }
        : {
            ...edge,
            data: { ...edge.data, highlight: false },
            markerStart,
            markerEnd,
          };
    });
};

export const highlightNodes = (nodeIds: string[], highlight: string[]) => {
  return (nodes: any) =>
    nodes.map((node: any) =>
      nodeIds.includes(node.id)
        ? { ...node, data: { ...node.data, highlight } }
        : { ...node, data: { ...node.data, highlight: [] } },
    );
};
