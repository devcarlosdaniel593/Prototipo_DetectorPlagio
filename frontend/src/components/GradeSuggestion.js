import React, { useEffect, useMemo, useState } from 'react';
import {
  computeSuggestedGrade,
  parseTeacherGradeInput,
  similarityToPrototypeGrade,
} from '../utils/gradeSuggestion';
import { formatPercent } from '../utils/format';

export default function GradeSuggestion({ similarityPercent }) {
  const [teacherInput, setTeacherInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [suggestion, setSuggestion] = useState(null);

  const prototypeGrade = useMemo(
    () => similarityToPrototypeGrade(similarityPercent),
    [similarityPercent],
  );

  useEffect(() => {
    setTeacherInput('');
    setInputError('');
    setSuggestion(null);
  }, [similarityPercent]);

  const handleCalculate = (e) => {
    e.preventDefault();
    setInputError('');

    const parsed = parseTeacherGradeInput(teacherInput);
    if (!parsed.valid) {
      setInputError(parsed.error);
      setSuggestion(null);
      return;
    }

    setSuggestion({
      prototypeGrade,
      teacherGrade: parsed.value,
      suggestedGrade: computeSuggestedGrade(prototypeGrade, parsed.value),
    });
  };

  return (
    <section className="grade-suggestion" aria-labelledby="grade-suggestion-title">
      <header className="grade-suggestion__header">
        <h3 id="grade-suggestion-title" className="grade-suggestion__title">
          Sugerencia de Calificación
        </h3>
        <p className="grade-suggestion__lead">
          Apoyo para el docente a partir del porcentaje de similitud detectado. No reemplaza
          la calificación oficial.
        </p>
      </header>

      <div className="grade-suggestion__metrics">
        <div className="grade-suggestion__metric">
          <span className="grade-suggestion__metric-label">Similitud detectada</span>
          <span className="grade-suggestion__metric-value">
            {formatPercent(similarityPercent)}
          </span>
        </div>
        <div className="grade-suggestion__metric grade-suggestion__metric--highlight">
          <span className="grade-suggestion__metric-label">Nota del prototipo (sobre 10)</span>
          <span className="grade-suggestion__metric-value">{prototypeGrade.toFixed(2)}</span>
          <span className="grade-suggestion__metric-hint">
            Calculada automáticamente: menor similitud → mayor nota.
          </span>
        </div>
      </div>

      <form className="grade-suggestion__form" onSubmit={handleCalculate}>
        <label className="grade-suggestion__label" htmlFor="teacher-grade-input">
          Calificación manual del docente (0 – 10)
        </label>
        <div className="grade-suggestion__form-row">
          <input
            id="teacher-grade-input"
            type="number"
            min="0"
            max="10"
            step="0.01"
            className="grade-suggestion__input"
            placeholder="Ej. 7.5"
            value={teacherInput}
            onChange={(e) => {
              setTeacherInput(e.target.value);
              if (inputError) setInputError('');
            }}
          />
          <button type="submit" className="grade-suggestion__btn">
            Calcular sugerencia
          </button>
        </div>
        {inputError && <div className="alert alert--error grade-suggestion__error">{inputError}</div>}
      </form>

      {suggestion && (
        <div className="grade-suggestion__results">
          <div className="grade-suggestion__result-row">
            <span>Nota del prototipo</span>
            <strong>{suggestion.prototypeGrade.toFixed(2)}</strong>
          </div>
          <div className="grade-suggestion__result-row">
            <span>Nota ingresada por el docente</span>
            <strong>{suggestion.teacherGrade.toFixed(2)}</strong>
          </div>
          <div className="grade-suggestion__result-row grade-suggestion__result-row--final">
            <span>Nota sugerida final</span>
            <strong>{suggestion.suggestedGrade.toFixed(2)}</strong>
          </div>
          <p className="grade-suggestion__formula muted">
            Promedio: ({suggestion.prototypeGrade.toFixed(2)} + {suggestion.teacherGrade.toFixed(2)}) / 2 ={' '}
            {suggestion.suggestedGrade.toFixed(2)}
          </p>
        </div>
      )}

      <p className="grade-suggestion__disclaimer">
        Esta calificación corresponde únicamente a una sugerencia generada por el sistema. La
        decisión final sobre la nota del documento corresponde exclusivamente al docente.
      </p>
    </section>
  );
}
