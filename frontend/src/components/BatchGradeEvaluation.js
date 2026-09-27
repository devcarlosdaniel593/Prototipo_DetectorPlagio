import React, { useEffect, useMemo, useState } from 'react';
import { getSimilarityFromBatchEntry } from '../utils/batchAnalysis';
import {
  computeSuggestedGrade,
  parseTeacherGradeInput,
  similarityToPrototypeGrade,
} from '../utils/gradeSuggestion';

const BATCH_DISCLAIMER =
  'Las calificaciones sugeridas corresponden únicamente a una recomendación generada por el sistema basada en el porcentaje de similitud y la calificación ingresada por el docente. La decisión final de evaluación corresponde exclusivamente al docente.';

function buildRowState(entry, index, teacherInputs) {
  const analyzed = entry.status === 'ok' && entry.result;
  const similarity = analyzed ? getSimilarityFromBatchEntry(entry) : null;
  const systemGrade =
    similarity != null ? similarityToPrototypeGrade(similarity) : null;
  const rawInput = teacherInputs[index] ?? '';
  const parsed = rawInput === '' ? null : parseTeacherGradeInput(rawInput);
  const teacherValid = parsed?.valid === true;
  const suggestedGrade =
    systemGrade != null && teacherValid
      ? computeSuggestedGrade(systemGrade, parsed.value)
      : null;
  const evaluationStatus = !analyzed
    ? 'Error de análisis'
    : teacherValid
    ? 'Evaluado'
    : 'Pendiente';

  return {
    index,
    name: entry.title || entry.fileName || `Documento ${index + 1}`,
    fileName: entry.fileName,
    analyzed,
    similarity,
    systemGrade,
    rawInput,
    inputError: parsed && !parsed.valid ? parsed.error : '',
    teacherGrade: teacherValid ? parsed.value : null,
    suggestedGrade,
    evaluationStatus,
  };
}

export default function BatchGradeEvaluation({ items }) {
  const [teacherInputs, setTeacherInputs] = useState({});

  useEffect(() => {
    setTeacherInputs({});
  }, [items]);

  const rows = useMemo(
    () => (items || []).map((entry, index) => buildRowState(entry, index, teacherInputs)),
    [items, teacherInputs],
  );

  const summary = useMemo(() => {
    const analyzedRows = rows.filter((r) => r.analyzed);
    const evaluatedRows = analyzedRows.filter((r) => r.teacherGrade != null);
    const similarities = analyzedRows
      .map((r) => r.similarity)
      .filter((s) => s != null);
    const suggestedGrades = evaluatedRows
      .map((r) => r.suggestedGrade)
      .filter((g) => g != null);

    const avgSimilarity =
      similarities.length > 0
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length
        : 0;
    const avgSuggested =
      suggestedGrades.length > 0
        ? suggestedGrades.reduce((a, b) => a + b, 0) / suggestedGrades.length
        : null;

    return {
      total: analyzedRows.length,
      evaluated: evaluatedRows.length,
      pending: analyzedRows.length - evaluatedRows.length,
      avgSimilarity,
      avgSuggested,
    };
  }, [rows]);

  if (!items?.length) return null;

  const handleTeacherChange = (index, value) => {
    setTeacherInputs((prev) => ({ ...prev, [index]: value }));
  };

  return (
    <section className="batch-grade" aria-labelledby="batch-grade-title">
      <header className="batch-grade__head">
        <h2 id="batch-grade-title" className="batch-grade__title">
          Evaluación por lote
        </h2>
        <p className="batch-grade__sub">
          Califique cada documento del envío. La calificación sugerida se calcula al ingresar
          la nota del docente (promedio con la nota del sistema).
        </p>
      </header>

      <div className="batch-grade__table-wrap">
        <table className="batch-grade__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Grupo / documento</th>
              <th>Similitud</th>
              <th>Nota sistema</th>
              <th>Nota docente</th>
              <th>Calificación sugerida</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`batch-grade-${row.index}`}>
                <td>{row.index + 1}</td>
                <td className="batch-grade__name">
                  <span className="batch-grade__doc-title">{row.name}</span>
                  {row.fileName && row.fileName !== row.name && (
                    <span className="batch-grade__file muted">{row.fileName}</span>
                  )}
                </td>
                <td>
                  {row.similarity != null ? (
                    <span className="batch-grade__sim">{row.similarity.toFixed(2)}%</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {row.systemGrade != null ? (
                    <strong>{row.systemGrade.toFixed(2)}</strong>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="batch-grade__teacher-cell">
                  {row.analyzed ? (
                    <>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        className={`batch-grade__input${
                          row.inputError ? ' batch-grade__input--error' : ''
                        }`}
                        placeholder="0 – 10"
                        value={row.rawInput}
                        onChange={(e) => handleTeacherChange(row.index, e.target.value)}
                        aria-label={`Nota docente para ${row.name}`}
                      />
                      {row.inputError && (
                        <span className="batch-grade__field-error">{row.inputError}</span>
                      )}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {row.suggestedGrade != null ? (
                    <strong className="batch-grade__suggested">
                      {row.suggestedGrade.toFixed(2)}
                    </strong>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span
                    className={`batch-grade__status batch-grade__status--${
                      row.evaluationStatus === 'Evaluado'
                        ? 'done'
                        : row.evaluationStatus === 'Pendiente'
                        ? 'pending'
                        : 'error'
                    }`}
                  >
                    {row.evaluationStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="batch-grade__summary">
        <h3 className="batch-grade__summary-title">Resumen del lote</h3>
        <div className="batch-grade__summary-grid">
          <div className="batch-grade__summary-item">
            <span>Total analizados</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="batch-grade__summary-item">
            <span>Evaluados</span>
            <strong>{summary.evaluated}</strong>
          </div>
          <div className="batch-grade__summary-item">
            <span>Pendientes</span>
            <strong>{summary.pending}</strong>
          </div>
          <div className="batch-grade__summary-item">
            <span>Promedio similitud</span>
            <strong>{summary.avgSimilarity.toFixed(2)}%</strong>
          </div>
          <div className="batch-grade__summary-item">
            <span>Promedio calificación sugerida</span>
            <strong>
              {summary.avgSuggested != null ? summary.avgSuggested.toFixed(2) : '—'}
            </strong>
          </div>
        </div>
      </div>

      <p className="batch-grade__disclaimer">{BATCH_DISCLAIMER}</p>
    </section>
  );
}
