import React, { useMemo } from 'react';
import {
  buildSourceColorMap,
  colorForSourceId,
} from '../utils/sourcePalette';

/**
 * Genera intervalos no solapados priorizando mayor similitud, luego recorre el texto en orden.
 */
function buildHighlightRanges(text, matches) {
  const ranges = [];
  for (const m of matches || []) {
    const needle = m.text1;
    if (!needle || needle.length < 4) continue;
    let from = 0;
    while (from <= text.length - needle.length) {
      const i = text.indexOf(needle, from);
      if (i === -1) break;
      ranges.push({
        start: i,
        end: i + needle.length,
        documentId: m.documentId,
        similarity: m.similarity,
        title: m.title,
      });
      from = i + 1;
    }
  }

  ranges.sort((a, b) => b.similarity - a.similarity || a.start - b.start);

  const picked = [];
  for (const r of ranges) {
    const overlaps = picked.some((p) => p.start < r.end && p.end > r.start);
    if (!overlaps) picked.push(r);
  }
  picked.sort((a, b) => a.start - b.start || a.end - b.end);
  return picked;
}

export default function HighlightText({ text, matches = [], summary = [] }) {
  const colorMap = useMemo(() => buildSourceColorMap(summary), [summary]);

  const { nodes, pickedRanges } = useMemo(() => {
    if (!text) return { nodes: [], pickedRanges: [] };
    const picked = buildHighlightRanges(text, matches);
    if (!picked.length) {
      return {
        nodes: [
          <span key="full" className="highlight-plain">
            {text}
          </span>,
        ],
        pickedRanges: [],
      };
    }

    const out = [];
    let cursor = 0;
    picked.forEach((r, idx) => {
      if (r.start > cursor) {
        out.push(
          <span key={`t-${cursor}-${r.start}`} className="highlight-plain">
            {text.slice(cursor, r.start)}
          </span>,
        );
      }
      const bg = colorForSourceId(r.documentId, colorMap);
      out.push(
        <mark
          key={`m-${r.start}-${r.end}-${idx}`}
          className="highlight-mark"
          style={{
            backgroundColor: bg,
            borderRadius: 4,
            padding: '1px 0',
          }}
          title={`${r.title || 'Fuente'} · ${Number(r.similarity).toFixed(1)}%`}
        >
          {text.slice(r.start, r.end)}
        </mark>,
      );
      cursor = r.end;
    });
    if (cursor < text.length) {
      out.push(
        <span key={`t-tail-${cursor}`} className="highlight-plain">
          {text.slice(cursor)}
        </span>,
      );
    }
    return { nodes: out, pickedRanges: picked };
  }, [text, matches, colorMap]);

  if (!text) return null;

  const showLegend = (summary || []).length > 0;

  return (
    <div className="highlight-root">
      <div className="highlighted-content highlight-full-doc">{nodes}</div>

      {showLegend ? (
        <div className="highlight-legend">
          <div className="highlight-legend-title">Leyenda de fuentes</div>
          <ul className="highlight-legend-list">
            {summary.map((s, i) => (
              <li key={`${s.documentId}-${i}`} className="highlight-legend-item">
                <span
                  className="highlight-legend-swatch"
                  style={{ backgroundColor: colorMap.get(s.documentId) }}
                />
                <span className="highlight-legend-num">{i + 1}</span>
                <span className="highlight-legend-name">{s.title}</span>
                {s.sourceType === 'web' ? (
                  <span className="highlight-legend-tag">Web</span>
                ) : null}
              </li>
            ))}
          </ul>
          {pickedRanges.length === 0 && matches.length > 0 ? (
            <p className="highlight-legend-note muted">
              Hay coincidencias pero no se pudieron alinear con el texto mostrado
              (formato PDF). Revisa la pestaña Matches.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
