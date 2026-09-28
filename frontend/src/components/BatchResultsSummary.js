import React from 'react';
import { getSimilarityFromBatchEntry } from '../utils/batchAnalysis';
import { formatPercent } from '../utils/format';

function levelClass(value) {
  if (value >= 80) return 'batch-sim batch-sim--high';
  if (value >= 50) return 'batch-sim batch-sim--mid';
  return 'batch-sim batch-sim--low';
}

export default function BatchResultsSummary({
  items,
  activeIndex,
  onSelect,
}) {
  if (!items?.length) return null;

  return (
    <section className="batch-summary" aria-label="Resumen de envíos analizados">
      <header className="batch-summary__head">
        <div>
          <h2 className="batch-summary__title">Resultados del envío</h2>
          <p className="batch-summary__sub">
            {items.length} documento{items.length !== 1 ? 's' : ''} procesado
            {items.length !== 1 ? 's' : ''}. Elige uno para ver el informe completo.
          </p>
        </div>
      </header>

      <div className="batch-summary__table-wrap">
        <table className="batch-summary__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Título</th>
              <th>Archivo</th>
              <th>Similitud</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry, idx) => {
              const sim = getSimilarityFromBatchEntry(entry);
              const isActive = idx === activeIndex;
              const clickable = entry.status === 'ok' && entry.result;

              return (
                <tr
                  key={`${entry.fileName}-${idx}`}
                  className={
                    isActive ? 'batch-summary__row batch-summary__row--active' : 'batch-summary__row'
                  }
                  onClick={() => clickable && onSelect(idx)}
                  onKeyDown={(e) => {
                    if (!clickable) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(idx);
                    }
                  }}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'button' : undefined}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <td>{idx + 1}</td>
                  <td className="batch-summary__cell-title">{entry.title}</td>
                  <td className="batch-summary__cell-file">{entry.fileName}</td>
                  <td>
                    {entry.status === 'ok' && sim != null ? (
                      <span className={levelClass(sim)}>{formatPercent(sim)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {entry.status === 'ok' ? (
                      <span className="batch-status batch-status--ok">Correcto</span>
                    ) : (
                      <span className="batch-status batch-status--err" title={entry.error || ''}>
                        Error
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
