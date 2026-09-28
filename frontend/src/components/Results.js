import React, { useMemo, useState } from 'react';
import HighlightText from './HighlightText';
import GradeSuggestion from './GradeSuggestion';
import { buildSourceColorMap } from '../utils/sourcePalette';
import { formatPercent } from '../utils/format';

export default function Results({ result }) {
  const [activeTab, setActiveTab] = useState('originality');

  const getLevelClass = (value) => {
    if (value >= 80) return 'level level--high';
    if (value >= 50) return 'level level--mid';
    return 'level level--low';
  };

  const getLevelLabel = (value) => {
    if (value >= 80) return 'Alto';
    if (value >= 50) return 'Medio';
    return 'Bajo';
  };

  const summary = useMemo(() => result?.summary || [], [result?.summary]);
  const matches = useMemo(() => result?.matches || [], [result?.matches]);
  const stylometry = result?.stylometry || null;

  const total = typeof result?.overallSimilarity === 'number'
    ? result.overallSimilarity
    : (summary.length
      ? summary.reduce((acc, doc) => acc + doc.similarity, 0) / summary.length
      : 0);

  const content = result?.document?.content || '';

  const getSourceBadge = (sourceType) => {
    if (sourceType === 'web') return { label: 'Web', className: 'badge badge--web' };
    return { label: 'Interno', className: 'badge badge--internal' };
  };

  const formatUrlText = (url) => {
    if (!url) return '';
    return url.replace(/^https?:\/\//i, '');
  };

  const sourceColors = useMemo(() => buildSourceColorMap(summary), [summary]);

  const detailsMetrics = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const paragraphs = content.trim()
      ? content.split(/\n{2,}|\r\n{2,}|\.\s+/).filter((p) => p.trim().length > 20).length
      : 0;

    const internalSources = summary.filter(
      (s) => (s.sourceType || 'internal') === 'internal',
    ).length;
    const webSources = summary.filter((s) => s.sourceType === 'web').length;

    const matchCountBySourceId = matches.reduce((acc, m) => {
      const key = m.documentId;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      words,
      paragraphs,
      sources: summary.length,
      matches: matches.length,
      internalSources,
      webSources,
      risk: total >= 80 ? 'Riesgo Alto' : total >= 50 ? 'Riesgo Medio' : 'Riesgo Bajo',
      matchCountBySourceId,
    };
  }, [content, matches, summary, total]);

  // ── Consistencia → color ──────────────────
  const getConsistencyColor = (score) => {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  const getConsistencyLabel = (score) => {
    if (score >= 80) return 'Consistente';
    if (score >= 50) return 'Moderado';
    return 'Inconsistente';
  };

  const getLikelihoodColor = (likelihood) => {
    if (likelihood === 'alta') return '#22c55e';
    if (likelihood === 'media') return '#f59e0b';
    return '#ef4444';
  };

  return (
    <section className="analysis-shell">
      <div className="analysis-topbar">
        <div className="tabs">
          <button
            type="button"
            className={`tab ${activeTab === 'originality' ? 'tab--active' : ''}`}
            onClick={() => setActiveTab('originality')}
          >
            Originalidad
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'details' ? 'tab--active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Detalles
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'matches' ? 'tab--active' : ''}`}
            onClick={() => setActiveTab('matches')}
          >
            Coincidencias
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'stylometry' ? 'tab--active' : ''}`}
            onClick={() => setActiveTab('stylometry')}
          >
            Estilometría
          </button>
        </div>
        <div className="score-box">
          <span className="score-label">SIMILITUD</span>
          <span className="score-value">{formatPercent(total)}</span>
          <span className={`score-chip ${getLevelClass(total)}`}>
            {getLevelLabel(total)}
          </span>
        </div>
      </div>

      <div className="analysis-layout">
        <article className="document-view">
          <header className="document-head">
            <h3>{result?.document?.title || 'Documento analizado'}</h3>
            <p>
              {activeTab === 'originality' && 'Vista del texto extraído desde PDF'}
              {activeTab === 'details' && 'Resumen técnico del análisis'}
              {activeTab === 'matches' && 'Lista detallada de coincidencias detectadas'}
              {activeTab === 'stylometry' && 'Análisis de huella de autoría y estilo de escritura'}
            </p>
          </header>

          <div className="document-content">
            {result?.semanticServiceStatus === 'degraded' && (
              <div className="alert alert--warning">
                El análisis semántico de IA estuvo degradado en esta corrida.
                El resultado puede tener menor precisión.
              </div>
            )}

            {/* ── ORIGINALIDAD ── */}
            {activeTab === 'originality' && (
              <HighlightText text={content} matches={matches} summary={summary} />
            )}

            {/* ── DETALLES ── */}
            {activeTab === 'details' && (
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">Similitud global</span>
                  <span className="detail-value">{formatPercent(total)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Servicio IA semántica</span>
                  <span className="detail-value">
                    {result?.semanticServiceStatus === 'degraded' ? 'Degradado' : 'Operativo'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Tiempo de análisis</span>
                  <span className="detail-value">
                    {typeof result?.analysisDurationMs === 'number'
                      ? result.analysisDurationMs < 1000
                        ? `${result.analysisDurationMs} ms`
                        : `${(result.analysisDurationMs / 1000).toFixed(2)} s`
                      : '—'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Nivel de riesgo</span>
                  <span className="detail-value">{detailsMetrics.risk}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Palabras analizadas</span>
                  <span className="detail-value">{detailsMetrics.words}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Párrafos analizados</span>
                  <span className="detail-value">{detailsMetrics.paragraphs}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Fuentes comparadas</span>
                  <span className="detail-value">{detailsMetrics.sources}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Fuentes internas</span>
                  <span className="detail-value">{detailsMetrics.internalSources}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Fuentes web</span>
                  <span className="detail-value">{detailsMetrics.webSources}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Coincidencias detectadas</span>
                  <span className="detail-value">{detailsMetrics.matches}</span>
                </div>
              </div>
            )}

            {/* ── COINCIDENCIAS ── */}
            {activeTab === 'matches' && (
              <div className="matches-detail-list">
                {matches.length ? (
                  matches.map((match, idx) => (
                    <div
                      key={`${match.documentId}-${idx}`}
                      className="matches-detail-card"
                      style={{
                        borderLeft: `4px solid ${sourceColors.get(match.documentId) || '#cbd5e1'}`,
                      }}
                    >
                      <div className="matches-detail-head">
                        <span className={`match-index ${getLevelClass(match.similarity)}`}>
                          {idx + 1}
                        </span>
                        <div className="matches-head-meta">
                          <div className="matches-head-title">{match.title}</div>
                          <div className="matches-head-submeta">
                            <span className={getSourceBadge(match.sourceType).className}>
                              {getSourceBadge(match.sourceType).label}
                            </span>
                            {match.url && (
                              <a className="match-inline-link" href={match.url} target="_blank" rel="noreferrer">
                                {match.url}
                              </a>
                            )}
                          </div>
                          <div className="matches-head-score">
                            {formatPercent(match.similarity)} similitud
                          </div>
                        </div>
                      </div>
                      <div className="match-snippet">
                        <strong>Texto detectado:</strong> {match.text1}
                      </div>
                      <div className="match-snippet match-snippet--source">
                        <strong>Referencia:</strong> {match.text2}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">No se detectaron coincidencias detalladas.</p>
                )}
              </div>
            )}

            {/* ── ESTILOMETRÍA ── */}
            {activeTab === 'stylometry' && (
              <div className="stylometry-container">
                {!stylometry ? (
                  <p className="muted">No hay datos estilométricos disponibles.</p>
                ) : (
                  <>
                    {/* Score de consistencia */}
                    <div className="stylo-consistency-card">
                      <div className="stylo-consistency-left">
                        <div className="stylo-consistency-title">Consistencia del documento</div>
                        <div className="stylo-consistency-sub">
                          Mide si el documento fue escrito por un solo autor de forma uniforme
                        </div>
                      </div>
                      <div className="stylo-consistency-score"
                        style={{ color: getConsistencyColor(stylometry.consistencyScore) }}>
                        <span className="stylo-score-number">{stylometry.consistencyScore}%</span>
                        <span className="stylo-score-label">
                          {getConsistencyLabel(stylometry.consistencyScore)}
                        </span>
                      </div>
                    </div>

                    {/* Perfil estilométrico */}
                    <div className="stylo-section">
                      <div className="stylo-section-title">Perfil del autor</div>
                      <div className="stylo-profile-grid">
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Long. promedio de oraciones</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min((stylometry.profile.avgSentenceLength / 40) * 100, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.avgSentenceLength} palabras</span>
                        </div>
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Long. promedio de palabras</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min((stylometry.profile.avgWordLength / 10) * 100, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.avgWordLength} letras</span>
                        </div>
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Riqueza de vocabulario</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min(stylometry.profile.vocabularyRichness, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.vocabularyRichness}%</span>
                        </div>
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Densidad de puntuación</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min((stylometry.profile.punctuationDensity / 30) * 100, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.punctuationDensity} por 100 palabras</span>
                        </div>
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Uso de conectores lógicos</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min((stylometry.profile.connectorUsage / 10) * 100, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.connectorUsage} por 100 palabras</span>
                        </div>
                        <div className="stylo-profile-item">
                          <span className="stylo-profile-label">Ratio de voz pasiva</span>
                          <div className="stylo-bar-wrap">
                            <div className="stylo-bar"
                              style={{ width: `${Math.min(stylometry.profile.passiveVoiceRatio, 100)}%` }} />
                          </div>
                          <span className="stylo-profile-value">{stylometry.profile.passiveVoiceRatio}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Anomalías */}
                    <div className="stylo-section">
                      <div className="stylo-section-title">
                        Anomalías de autoría detectadas
                        <span className="stylo-anomaly-count">
                          {stylometry.anomalies.length === 0
                            ? '✓ Ninguna'
                            : `⚠️ ${stylometry.anomalies.length} detectada(s)`}
                        </span>
                      </div>
                      {stylometry.anomalies.length === 0 ? (
                        <div className="stylo-no-anomaly">
                          El documento presenta un estilo de escritura uniforme. No se detectaron
                          cambios abruptos de autoría.
                        </div>
                      ) : (
                        <div className="stylo-anomaly-list">
                          {stylometry.anomalies.map((anomaly, idx) => (
                            <div key={idx} className="stylo-anomaly-card">
                              <div className="stylo-anomaly-head">
                                <span className="stylo-anomaly-idx">Segmento {anomaly.segmentIndex + 1}</span>
                                <span className="stylo-anomaly-dev"
                                  style={{ color: anomaly.deviation >= 60 ? '#ef4444' : '#f59e0b' }}>
                                  Desviación: {anomaly.deviation}%
                                </span>
                              </div>
                              <div className="stylo-anomaly-reason">{anomaly.reason}</div>
                              <div className="stylo-anomaly-text">"{anomaly.segmentText}"</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Comparación de autoría */}
                    {stylometry.authorshipMatches.length > 0 && (
                      <div className="stylo-section">
                        <div className="stylo-section-title">Comparación de autoría con otros documentos</div>
                        <div className="stylo-authorship-list">
                          {stylometry.authorshipMatches.map((match, idx) => (
                            <div key={idx} className="stylo-authorship-row">
                              <div className="stylo-authorship-title">{match.title}</div>
                              <div className="stylo-authorship-bar-wrap">
                                <div className="stylo-authorship-bar"
                                  style={{
                                    width: `${match.styleScore}%`,
                                    backgroundColor: getLikelihoodColor(match.sameAuthorLikelihood),
                                  }} />
                              </div>
                              <div className="stylo-authorship-meta">
                                <span className="stylo-authorship-score">{match.styleScore}%</span>
                                <span className="stylo-authorship-likelihood"
                                  style={{ color: getLikelihoodColor(match.sameAuthorLikelihood) }}>
                                  Prob. {match.sameAuthorLikelihood}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </article>

        <aside className="matches-panel">
          <div className="matches-title">Resumen de coincidencias</div>

          {summary.length ? (
            <div className="matches-list">
              {summary.map((doc, idx) => (
                <div key={`${doc.title}-${idx}`} className="match-row">
                  <div className="match-left">
                    <span
                      className="source-color-dot"
                      style={{ backgroundColor: sourceColors.get(doc.documentId) || '#94a3b8' }}
                      title={`Fuente ${idx + 1}`}
                    />
                    <span className={`match-index ${getLevelClass(doc.similarity)}`}>
                      {idx + 1}
                    </span>
                    <div className="match-source">
                      <div className="match-source-top">
                        <span className={getSourceBadge(doc.sourceType).className}>
                          {getSourceBadge(doc.sourceType).label}
                        </span>
                        <span className="match-source-title">{doc.title}</span>
                      </div>
                      {doc.url && (
                        <a className="match-source-link" href={doc.url} target="_blank" rel="noreferrer">
                          {formatUrlText(doc.url)}
                        </a>
                      )}
                      <div className="match-submeta">
                        {detailsMetrics.matchCountBySourceId[doc.documentId] || 0} fragmentos
                      </div>
                    </div>
                  </div>
                  <span className="match-value">{formatPercent(doc.similarity)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Sin fuentes detectadas todavía.</p>
          )}

          {/* Mini resumen estilométrico en sidebar */}
          {stylometry && (
            <div className="stylo-sidebar-card">
              <div className="stylo-sidebar-title">Estilometría</div>
              <div className="stylo-sidebar-row">
                <span>Consistencia</span>
                <span style={{ color: getConsistencyColor(stylometry.consistencyScore), fontWeight: 700 }}>
                  {stylometry.consistencyScore}%
                </span>
              </div>
              <div className="stylo-sidebar-row">
                <span>Anomalías</span>
                <span style={{ fontWeight: 700 }}>
                  {stylometry.anomalies.length === 0 ? '✓ Ninguna' : `⚠️ ${stylometry.anomalies.length}`}
                </span>
              </div>
              <div className="stylo-sidebar-row">
                <span>Docs. mismo autor</span>
                <span style={{ fontWeight: 700 }}>
                  {stylometry.authorshipMatches.filter(m => m.sameAuthorLikelihood === 'alta').length}
                </span>
              </div>
              <button
                className="stylo-sidebar-btn"
                onClick={() => {}}
                type="button"
              >
                Ver análisis completo →
              </button>
            </div>
          )}

          <div className="matches-footnote">
            Reporte prototipo: similitud híbrida por tramos (IA semántica + TF-IDF) sobre fuentes internas y web.
          </div>
        </aside>
      </div>

      <GradeSuggestion similarityPercent={total} />
    </section>
  );
}