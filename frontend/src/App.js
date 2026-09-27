import React, { useMemo, useState } from 'react';
import './App.css';
import UploadForm from './components/UploadForm';
import Results from './components/Results';
import EvaluationReport from './components/EvaluationReport';
import BatchResultsSummary from './components/BatchResultsSummary';
import BatchGradeEvaluation from './components/BatchGradeEvaluation';

function App() {
  const [result, setResult] = useState(null);
  const [batchResults, setBatchResults] = useState(null);
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [view, setView] = useState('analyzer'); // 'analyzer' | 'evaluation'
  const [evaluationRefreshKey, setEvaluationRefreshKey] = useState(0);

  const bumpEvaluationDashboard = () => {
    setEvaluationRefreshKey((k) => k + 1);
  };

  const displayedResult = useMemo(() => {
    if (batchResults?.length) {
      const entry = batchResults[activeBatchIndex];
      if (entry?.status === 'ok' && entry.result) return entry.result;
      return null;
    }
    return result;
  }, [batchResults, activeBatchIndex, result]);

  const handleBatchSelect = (index) => {
    setActiveBatchIndex(index);
  };

  return (
    <>
      <div className="header">
        <div className="header-left">
          <span className="header-logo">🔍</span>
          <span className="header-title">DetectIA — Prototipo UCE</span>
        </div>
        <div className="header-nav">
          <button
            className={`nav-btn ${view === 'analyzer' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('analyzer')}
          >
            Analizador
          </button>
          <button
            className={`nav-btn ${view === 'evaluation' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('evaluation')}
          >
            Reporte de Evaluación
          </button>
        </div>
      </div>

      <div className="container">
        {view === 'analyzer' && (
          <>
            <div className="card">
              <UploadForm
                setResult={setResult}
                setBatchResults={setBatchResults}
                setActiveBatchIndex={setActiveBatchIndex}
                onAnalysisComplete={bumpEvaluationDashboard}
              />
            </div>
            {batchResults?.length > 0 && (
              <div className="card card--flush">
                <BatchResultsSummary
                  items={batchResults}
                  activeIndex={activeBatchIndex}
                  onSelect={handleBatchSelect}
                />
              </div>
            )}
            {displayedResult && <Results result={displayedResult} />}
            {batchResults?.length > 0 && (
              <div className="card card--flush">
                <BatchGradeEvaluation items={batchResults} />
              </div>
            )}
          </>
        )}

        {view === 'evaluation' && (
          <EvaluationReport refreshKey={evaluationRefreshKey} />
        )}
      </div>
    </>
  );
}

export default App;