import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getEvaluationReport, setReferenceLabel } from '../services/api';

const CHART_COLORS = {
  precision: '#3b82f6',
  recall: '#8b5cf6',
  f1: '#e0534e',
};

function getMetricColor(value) {
  if (value === null || value === undefined) return '#94a3b8';
  if (value >= 80) return '#22c55e';
  if (value >= 60) return '#f59e0b';
  return '#ef4444';
}

function getRiskMeta(level) {
  if (level === 'alto') return { label: 'Alto', className: 'dash-risk dash-risk--high' };
  if (level === 'medio') return { label: 'Medio', className: 'dash-risk dash-risk--mid' };
  return { label: 'Bajo', className: 'dash-risk dash-risk--low' };
}

/** Gráfico de barras: Precisión, Recall y F1 (solo con documentos etiquetados) */
function MetricsComparisonChart({ precision, recall, f1Score }) {
  if (precision === null && recall === null && f1Score === null) {
    return (
      <div className="dash-chart-card">
        <h3 className="dash-chart-title">Comparación de métricas</h3>
        <p className="dash-chart-empty">
          Aún no hay documentos con etiqueta de referencia. Asigna la etiqueta
          (Similar / Original) en la tabla experimental para calcular las métricas.
        </p>
      </div>
    );
  }

  const metrics = [
    { key: 'precision', label: 'Precisión', value: precision, color: CHART_COLORS.precision },
    { key: 'recall', label: 'Recall', value: recall, color: CHART_COLORS.recall },
    { key: 'f1', label: 'F1 Score', value: f1Score, color: CHART_COLORS.f1 },
  ];

  const maxVal = 100;
  const chartW = 320;
  const chartH = 220;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 48;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const barGap = 24;
  const barW = (innerW - barGap * (metrics.length - 1)) / metrics.length;

  return (
    <div className="dash-chart-card">
      <h3 className="dash-chart-title">Comparación de métricas</h3>
      <p className="dash-chart-subtitle">Precisión, Recall y F1 Score del sistema (%)</p>
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="dash-chart-svg"
        role="img"
        aria-label="Gráfico de barras con precisión, recall y F1"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padT + innerH - (tick / maxVal) * innerH;
          return (
            <g key={tick}>
              <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {tick}
              </text>
            </g>
          );
        })}

        {metrics.map((m, i) => {
          const value = m.value ?? 0;
          const barH = (value / maxVal) * innerH;
          const x = padL + i * (barW + barGap);
          const y = padT + innerH - barH;
          return (
            <g key={m.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, 2)}
                rx="6"
                fill={m.color}
                opacity="0.92"
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#0f172a"
              >
                {m.value === null ? '—' : `${m.value}%`}
              </text>
              <text
                x={x + barW / 2}
                y={chartH - 14}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="#475569"
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Gráfico de barras horizontales: similitud por documento real */
function DocumentResultsChart({ documents, threshold }) {
  if (!documents?.length) {
    return (
      <div className="dash-chart-card">
        <h3 className="dash-chart-title">Resultados por documento</h3>
        <p className="dash-chart-empty">No hay documentos para graficar.</p>
      </div>
    );
  }

  const sorted = [...documents].sort((a, b) => b.overallSimilarity - a.overallSimilarity);
  const maxVal = Math.max(100, ...sorted.map((d) => d.overallSimilarity));

  return (
    <div className="dash-chart-card dash-chart-card--wide">
      <h3 className="dash-chart-title">Gráfico de resultados experimentales</h3>
      <p className="dash-chart-subtitle">
        Similitud global detectada por documento (umbral de detección: {threshold}%)
      </p>
      <div className="dash-doc-chart">
        <div className="dash-doc-chart__axis" aria-hidden>
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
        <div className="dash-doc-chart__body">
          {sorted.map((doc) => {
            const pct = (doc.overallSimilarity / maxVal) * 100;
            const color =
              doc.overallSimilarity >= 80
                ? '#ef4444'
                : doc.overallSimilarity >= 50
                ? '#f59e0b'
                : '#22c55e';
            return (
              <div key={doc.documentId} className="dash-doc-row">
                <div className="dash-doc-row__label" title={doc.title}>
                  <span className="dash-doc-row__id">#{doc.documentId}</span>
                  <span className="dash-doc-row__title">{doc.title}</span>
                </div>
                <div className="dash-doc-row__track">
                  <div
                    className="dash-doc-row__bar"
                    style={{ width: `${pct}%`, background: color }}
                  />
                  <span className="dash-doc-row__value">{doc.overallSimilarity}%</span>
                </div>
              </div>
            );
          })}
          <div
            className="dash-doc-threshold"
            style={{ left: `${(threshold / maxVal) * 100}%` }}
            title={`Umbral ${threshold}%`}
          >
            <span className="dash-doc-threshold__line" />
            <span className="dash-doc-threshold__label">Umbral</span>
          </div>
        </div>
      </div>
      <div className="dash-doc-legend">
        <span><i className="dash-dot dash-dot--low" /> Bajo (&lt;50%)</span>
        <span><i className="dash-dot dash-dot--mid" /> Medio (50–79%)</span>
        <span><i className="dash-dot dash-dot--high" /> Alto (≥80%)</span>
      </div>
    </div>
  );
}

/** Tarjeta KPI individual */
function KpiCard({ label, value, description, accent, highlight }) {
  return (
    <div className={`dash-kpi ${highlight ? 'dash-kpi--highlight' : ''}`}>
      <div className="dash-kpi__header">
        <span className="dash-kpi__label">{label}</span>
        <span className="dash-kpi__accent" style={{ background: accent }} />
      </div>
      <div className="dash-kpi__value" style={{ color: getMetricColor(value) }}>
        {value === null || value === undefined ? '—' : `${value}%`}
      </div>
      <div className="dash-kpi__ring" aria-hidden>
        <svg viewBox="0 0 36 36" className="dash-kpi__ring-svg">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="3"
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeDasharray={`${value ?? 0}, 100`}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="dash-kpi__desc">{description}</p>
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-EC');
}

export default function EvaluationReport({ refreshKey = 0 }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingLabelId, setSavingLabelId] = useState(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    console.log('[EvalReport] Cargando dashboard desde métricas guardadas…');
    try {
      const res = await getEvaluationReport();
      console.log(
        `[EvalReport] Dashboard listo — ${res.data?.documentsWithMetrics ?? 0} documento(s) con métricas.`,
      );
      setReport(res.data);
    } catch (err) {
      const detail =
        err?.response?.data?.message || err?.message || 'Error desconocido';
      console.error('[EvalReport] Error:', detail);
      setError(
        !err?.response
          ? 'No hay conexión con el backend.'
          : `No se pudo cargar el dashboard: ${detail}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport, refreshKey]);

  /** Guarda la etiqueta de referencia y recarga el reporte para recalcular métricas. */
  const handleLabelChange = useCallback(
    async (documentId, value) => {
      setSavingLabelId(documentId);
      setError('');
      try {
        await setReferenceLabel(documentId, value === '' ? null : value);
        const res = await getEvaluationReport();
        setReport(res.data);
      } catch (err) {
        const detail = err?.response?.data?.message || err?.message || 'Error desconocido';
        setError(`No se pudo guardar la etiqueta: ${detail}`);
      } finally {
        setSavingLabelId(null);
      }
    },
    [],
  );

  const pr = report?.precisionRecall;
  const docs = report?.perDocument || [];

  const tableStats = useMemo(() => {
    if (!docs.length) return null;
    const similar = docs.filter((d) => d.systemClassification === 'similar').length;
    const avgSim = docs.reduce((a, d) => a + d.overallSimilarity, 0) / docs.length;
    return { similar, total: docs.length, avgSim };
  }, [docs]);

  return (
    <div className="dash">
      {/* Encabezado */}
      <header className="dash-header">
        <div>
          <h2 className="dash-header__title">Dashboard de Evaluación Experimental</h2>
          <p className="dash-header__subtitle">
            Métricas precalculadas al subir cada PDF. El dashboard se actualiza automáticamente
            cuando analizas documentos en el analizador.
          </p>
        </div>
        <button
          className="eval-generate-btn"
          onClick={loadReport}
          disabled={loading}
          type="button"
        >
          {loading ? 'Actualizando…' : 'Actualizar dashboard'}
        </button>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      {loading && (
        <div className="eval-loading">
          <div className="eval-spinner" />
          <p>Cargando métricas guardadas…</p>
        </div>
      )}

      {!loading && report?.documentsPendingMetrics > 0 && (
        <div className="alert alert--warning">
          {report.documentsPendingMetrics} documento(s) en la BD aún sin métricas guardadas.
          Analízalos subiéndolos desde el <strong>Analizador</strong> para incluirlos en el reporte.
        </div>
      )}

      {!loading && report && report.documentsWithMetrics === 0 && !error && (
        <div className="eval-empty">
          <div className="eval-empty-icon">📊</div>
          <p>{report.summary}</p>
        </div>
      )}

      {report && !loading && report.documentsWithMetrics > 0 && (
        <>
          {/* Meta info */}
          <div className="dash-meta">
            <span>Dashboard generado: {formatDateTime(report.generatedAt)}</span>
            <span>Con métricas: {report.documentsWithMetrics}</span>
            <span>En BD total: {report.totalDocumentsInDB}</span>
            <span>Último análisis guardado: {formatDateTime(report.lastAnalysisAt)}</span>
            {pr && <span>Umbral: {pr.similarityThreshold}%</span>}
          </div>

          {/* ── KPIs: Precisión, Recall, F1 ── */}
          <section className="dash-section" aria-labelledby="dash-kpis-title">
            <h3 id="dash-kpis-title" className="dash-section__title">
              Métricas de evaluación
            </h3>
            <div className="dash-kpi-grid">
              <KpiCard
                label="Precisión"
                value={pr?.precision ?? null}
                accent={CHART_COLORS.precision}
                description="De los documentos que el sistema marcó como similares, qué porcentaje estaba etiquetado como similar."
              />
              <KpiCard
                label="Recall"
                value={pr?.recall ?? null}
                accent={CHART_COLORS.recall}
                description="De los documentos etiquetados como similares, qué porcentaje detectó el sistema."
              />
              <KpiCard
                label="F1 Score"
                value={pr?.f1Score ?? null}
                accent={CHART_COLORS.f1}
                highlight
                description="Media armónica entre precisión y recall."
              />
            </div>

            <div className="dash-kpi-footer">
              <div className="dash-kpi-stat">
                <span className="dash-kpi-stat__label">Detectados como similares</span>
                <strong>{pr?.detectedAsSimilar ?? 0}</strong>
              </div>
              <div className="dash-kpi-stat">
                <span className="dash-kpi-stat__label">Documentos etiquetados</span>
                <strong>
                  {pr?.labeledDocuments ?? 0}/{pr?.totalDocuments ?? 0}
                </strong>
              </div>
              <div className="dash-kpi-stat">
                <span className="dash-kpi-stat__label">Matriz de confusión (VP · FP · VN · FN)</span>
                <strong>
                  {pr?.truePositives ?? 0} · {pr?.falsePositives ?? 0} · {pr?.trueNegatives ?? 0} ·{' '}
                  {pr?.falseNegatives ?? 0}
                </strong>
              </div>
              <div className="dash-kpi-stat">
                <span className="dash-kpi-stat__label">Exactitud</span>
                <strong>{pr?.accuracy === null || pr?.accuracy === undefined ? '—' : `${pr.accuracy}%`}</strong>
              </div>
            </div>
          </section>

          {/* ── Gráficos ── */}
          <section className="dash-section" aria-labelledby="dash-charts-title">
            <h3 id="dash-charts-title" className="dash-section__title">
              Gráficos de resultados
            </h3>
            <div className="dash-charts-grid">
              <MetricsComparisonChart
                precision={pr?.precision ?? null}
                recall={pr?.recall ?? null}
                f1Score={pr?.f1Score ?? null}
              />
              <DocumentResultsChart
                documents={docs}
                threshold={pr?.similarityThreshold ?? 40}
              />
            </div>
          </section>

          {/* ── Tabla experimental ── */}
          <section className="dash-section" aria-labelledby="dash-table-title">
            <div className="dash-table-head">
              <div>
                <h3 id="dash-table-title" className="dash-section__title dash-section__title--inline">
                  Tabla experimental — documentos reales
                </h3>
                <p className="dash-table-lead">
                  Resultados individuales obtenidos al analizar cada documento del corpus.
                  {tableStats && (
                    <>
                      {' '}
                      Promedio de similitud: <strong>{tableStats.avgSim.toFixed(2)}%</strong>
                      {' · '}
                      Clasificados como similares:{' '}
                      <strong>
                        {tableStats.similar}/{tableStats.total}
                      </strong>
                    </>
                  )}
                </p>
              </div>
            </div>

            {docs.length === 0 ? (
              <p className="dash-chart-empty">No hay documentos analizados en esta corrida.</p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <caption className="dash-table-caption">
                    Tabla 1. Resultados experimentales del sistema de detección de similitud sobre
                    documentos reales ({docs.length} registro{docs.length !== 1 ? 's' : ''}).
                  </caption>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>ID</th>
                      <th>Documento</th>
                      <th>Similitud (%)</th>
                      <th>Fuentes</th>
                      <th>Consistencia (%)</th>
                      <th>Anomalías</th>
                      <th>Clasificación</th>
                      <th>Detección</th>
                      <th>Etiqueta de referencia</th>
                      <th>Tiempo (s)</th>
                      <th>Analizado</th>
                      <th>IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc, idx) => {
                      const risk = getRiskMeta(doc.riskLevel);
                      return (
                        <tr key={doc.documentId}>
                          <td className="dash-table__num">{idx + 1}</td>
                          <td>{doc.documentId}</td>
                          <td className="dash-table__title">{doc.title}</td>
                          <td>
                            <span
                              className="dash-table__sim"
                              style={{ color: getMetricColor(100 - doc.overallSimilarity) }}
                            >
                              {doc.overallSimilarity}%
                            </span>
                          </td>
                          <td>{doc.sourcesFound}</td>
                          <td>{doc.consistencyScore}%</td>
                          <td>{doc.anomaliesDetected}</td>
                          <td>
                            <span className={risk.className}>{risk.label}</span>
                          </td>
                          <td>
                            <span
                              className={
                                doc.detectedAsSimilar
                                  ? 'dash-badge dash-badge--yes'
                                  : 'dash-badge dash-badge--no'
                              }
                            >
                              {doc.detectedAsSimilar ? 'Similar' : 'No similar'}
                            </span>
                          </td>
                          <td>
                            <select
                              className="dash-label-select"
                              value={doc.referenceLabel ?? ''}
                              disabled={savingLabelId === doc.documentId}
                              onChange={(e) => handleLabelChange(doc.documentId, e.target.value)}
                              aria-label={`Etiqueta de referencia de ${doc.title}`}
                            >
                              <option value="">Sin etiqueta</option>
                              <option value="similar">Similar</option>
                              <option value="original">Original</option>
                            </select>
                          </td>
                          <td>{(doc.processingTimeMs / 1000).toFixed(2)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {formatDateTime(doc.analyzedAt)}
                          </td>
                          <td>
                            <span
                              className={
                                doc.semanticServiceStatus === 'ok'
                                  ? 'dash-ia dash-ia--ok'
                                  : 'dash-ia dash-ia--warn'
                              }
                            >
                              {doc.semanticServiceStatus === 'ok' ? 'OK' : 'Degradado'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Resumen textual (colapsable visual secundario) */}
          <details className="dash-details">
            <summary>Resumen narrativo y métricas complementarias</summary>
            <p className="dash-details__text">{report.summary}</p>
            <div className="eval-perf-grid dash-details__grid">
              <div className="eval-perf-item">
                <span className="eval-perf-label">Tiempo promedio</span>
                <span className="eval-perf-value">
                  {(report.performance.avgProcessingTimeMs / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="eval-perf-item">
                <span className="eval-perf-label">Consistencia estilométrica (media)</span>
                <span className="eval-perf-value">
                  {report.stylometry.avgConsistencyScore}%
                </span>
              </div>
              <div className="eval-perf-item">
                <span className="eval-perf-label">Anomalías de autoría</span>
                <span className="eval-perf-value">{report.stylometry.withAnomalies}</span>
              </div>
              <div className="eval-perf-item">
                <span className="eval-perf-label">Servicio IA degradado</span>
                <span className="eval-perf-value">
                  {report.performance.degradedServiceCount}
                </span>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
