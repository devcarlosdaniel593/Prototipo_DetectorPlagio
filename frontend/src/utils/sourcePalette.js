export const SOURCE_PALETTE = [
  'rgba(235, 87, 87, 0.38)',
  'rgba(47, 128, 237, 0.34)',
  'rgba(111, 207, 151, 0.38)',
  'rgba(242, 201, 76, 0.42)',
  'rgba(155, 89, 182, 0.34)',
  'rgba(230, 126, 34, 0.35)',
  'rgba(72, 201, 176, 0.35)',
  'rgba(199, 140, 208, 0.38)',
];

export function buildSourceColorMap(summary) {
  const map = new Map();
  (summary || []).forEach((entry, index) => {
    map.set(entry.documentId, SOURCE_PALETTE[index % SOURCE_PALETTE.length]);
  });
  return map;
}

export function colorForSourceId(documentId, colorMap) {
  if (colorMap.has(documentId)) return colorMap.get(documentId);
  return SOURCE_PALETTE[Math.abs(Number(documentId)) % SOURCE_PALETTE.length];
}
