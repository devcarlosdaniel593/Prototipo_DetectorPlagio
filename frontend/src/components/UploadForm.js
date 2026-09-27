import React, { useState, useRef, useCallback } from 'react';
import { uploadDocument, uploadDocumentBatch } from '../services/api';

const MAX_FILES = 10;
const MAX_SIZE_MB = 10;

function titleFromFileName(name) {
  return name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || name;
}

export default function UploadForm({
  setResult,
  setBatchResults,
  setActiveBatchIndex,
  onAnalysisComplete,
}) {
  const [files, setFiles] = useState([]); // [{ file, title }]
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [saveToRepository, setSaveToRepository] = useState(true);
  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);

  const addPdfFiles = useCallback(
    (fileList) => {
      const selected = Array.from(fileList || []);
      const valid = selected.filter((f) => f.type === 'application/pdf');
      const rejected = selected.length - valid.length;
      const oversized = valid.filter((f) => f.size > MAX_SIZE_MB * 1024 * 1024);

      if (oversized.length) {
        setError(`${oversized.map((f) => f.name).join(', ')} supera los ${MAX_SIZE_MB}MB.`);
        return;
      }

      if (rejected > 0 && valid.length === 0) {
        setError('Solo se admiten archivos PDF.');
        return;
      }

      const combined = [
        ...files,
        ...valid.map((f) => ({ file: f, title: titleFromFileName(f.name) })),
      ];
      if (combined.length > MAX_FILES) {
        setError(`Máximo ${MAX_FILES} archivos por análisis.`);
        return;
      }

      setError('');
      setFiles(combined);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [files],
  );

  // ── Agregar archivos seleccionados ───────────────────────────────────────
  const handleFilesChange = (e) => {
    addPdfFiles(e.target.files);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (isSubmitting || files.length >= MAX_FILES) return;
    const dt = e.dataTransfer;
    if (dt?.files?.length) addPdfFiles(dt.files);
  };

  // ── Actualizar título de un archivo individual ───────────────────────────
  const handleTitleChange = (index, value) => {
    setFiles((prev) =>
      prev.map((item, i) => (i === index ? { ...item, title: value } : item)),
    );
  };

  // ── Eliminar un archivo de la lista ──────────────────────────────────────
  const handleRemove = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (files.length === 0) {
      setError('Selecciona al menos un PDF para analizar.');
      return;
    }

    const missingTitles = files
      .map((item, i) => (!item.title.trim() ? i + 1 : null))
      .filter(Boolean);
    if (missingTitles.length) {
      setError(`Falta el título del archivo ${missingTitles.join(', ')}.`);
      return;
    }

    setIsSubmitting(true);
    setProgress(0);

    try {
      if (files.length === 1) {
        // ── Un solo archivo: usa el endpoint original ─────────────────────
        setStatusMsg(
          saveToRepository
            ? 'Subiendo y analizando documento…'
            : 'Analizando documento (solo sesión, sin guardar en repositorio)…',
        );
        const formData = new FormData();
        formData.append('file', files[0].file);
        formData.append('title', files[0].title.trim());
        formData.append('userId', '1');
        formData.append('persistToRepository', saveToRepository ? 'true' : 'false');

        const res = await uploadDocument(formData, {
          onUploadProgress: (evt) => {
            const pct = evt.total ? Math.round((evt.loaded * 100) / evt.total) : 0;
            setProgress(pct);
          },
        });

        setProgress(100);
        setStatusMsg('');
        if (setBatchResults) setBatchResults(null);
        if (setActiveBatchIndex) setActiveBatchIndex(0);
        setResult(res.data);
        if (saveToRepository && onAnalysisComplete) onAnalysisComplete();
      } else {
        // ── Múltiples archivos: endpoint batch ────────────────────────────
        setStatusMsg(
          saveToRepository
            ? `Subiendo ${files.length} documentos…`
            : `Analizando ${files.length} documentos (solo sesión, sin guardar)…`,
        );
        const fileList = files.map((item) => item.file);
        const titleList = files.map((item) => item.title.trim());

        const res = await uploadDocumentBatch(fileList, titleList, 1, {
          persistToRepository: saveToRepository,
          onUploadProgress: (evt) => {
            const pct = evt.total ? Math.round((evt.loaded * 100) / evt.total) : 0;
            setProgress(Math.round(pct * 0.85));
          },
        });

        setStatusMsg('Finalizando análisis…');
        setProgress(100);
        setStatusMsg('');
        setResult(null);
        const data = res.data;
        if (setBatchResults) setBatchResults(data);
        if (setActiveBatchIndex) {
          const firstOk = data.findIndex((row) => row.status === 'ok' && row.result);
          setActiveBatchIndex(firstOk >= 0 ? firstOk : 0);
        }
        if (saveToRepository && onAnalysisComplete) onAnalysisComplete();
      }

      // Limpiar formulario tras éxito
      setFiles([]);
    } catch (err) {
      console.error(err);
      const msg =
        err?.response?.data?.message ||
        'No se pudo subir/analizar el documento. Revisa el backend e inténtalo de nuevo.';
      setError(Array.isArray(msg) ? msg.join('. ') : msg);
    } finally {
      setIsSubmitting(false);
      setProgress(0);
      setStatusMsg('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="upload-form">
      <div className="upload-form__intro">
        <h2 className="upload-form__title">Nuevo envío de documentos</h2>
        <p className="upload-form__hint">
          Arrastra PDF aquí o haz clic para elegir. Puedes enviar hasta {MAX_FILES} archivos en un
          solo lote y revisar el informe de similitud de cada uno (como en Turnitin).
        </p>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <label className="persist-option">
        <input
          type="checkbox"
          className="persist-option__checkbox"
          checked={saveToRepository}
          onChange={(e) => setSaveToRepository(e.target.checked)}
          disabled={isSubmitting}
        />
        <span className="persist-option__body">
          <span className="persist-option__title">
            Guardar documentos analizados en el repositorio
          </span>
          <span className="persist-option__desc">
            Si esta opción está activada, los documentos analizados se almacenarán en la base de
            datos y podrán utilizarse como referencia en futuros análisis. Si está desactivada, los
            documentos solo serán analizados durante la sesión actual y no se almacenarán.
          </span>
        </span>
      </label>

      {/* ── Zona de selección y soltar ───────────────────────────────── */}
      <div
        className={`upload-dropzone ${isDragging ? 'upload-dropzone--active' : ''} ${
          files.length >= MAX_FILES ? 'upload-dropzone--full' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="upload-dropzone__inner">
          <div className="upload-dropzone__icon" aria-hidden>
            📄
          </div>
          <div className="upload-dropzone__text">
            <strong>
              {files.length >= MAX_FILES
                ? `Límite alcanzado (${MAX_FILES} archivos)`
                : 'Suelta los PDF aquí'}
            </strong>
            <span className="upload-dropzone__or">o</span>
            <label className="file-pill file-pill--primary">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={handleFilesChange}
                disabled={isSubmitting || files.length >= MAX_FILES}
              />
              <span>
                {files.length === 0
                  ? 'Examinar archivos'
                  : files.length >= MAX_FILES
                  ? `Máximo ${MAX_FILES} archivos`
                  : 'Agregar más PDF'}
              </span>
            </label>
          </div>
          <p className="upload-dropzone__meta">
            Solo PDF · máx. {MAX_SIZE_MB} MB por archivo · hasta {MAX_FILES} por envío
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="file-queue-label">
          Cola de envío ({files.length}/{MAX_FILES})
        </div>
      )}

      {/* ── Lista de archivos con título editable ─────────────────────── */}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((item, index) => (
            <div key={`${item.file.name}-${item.file.size}-${index}`} className="file-list__item">
              <div className="file-list__icon" aria-hidden>
                PDF
              </div>
              <div className="file-list__body">
                <div className="file-list__top">
                  <div className="file-name" title={item.file.name}>
                    {item.file.name}
                  </div>
                  <button
                    type="button"
                    className="file-list__remove"
                    onClick={() => handleRemove(index)}
                    disabled={isSubmitting}
                    title="Quitar de la cola"
                  >
                    ✕
                  </button>
                </div>
                <div className="file-sub">
                  {(item.file.size / (1024 * 1024)).toFixed(2)} MB · Documento {index + 1}
                </div>
                <label className="file-list__title-label">
                  Título para el análisis
                  <input
                    type="text"
                    className="file-list__title-input"
                    placeholder={`Ej. Ensayo final — tema ${index + 1}`}
                    value={item.title}
                    onChange={(e) => handleTitleChange(index, e.target.value)}
                    disabled={isSubmitting}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Barra de progreso ─────────────────────────────────────────── */}
      {isSubmitting && (
        <div className="progress-wrap">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-label">
            {statusMsg || `${progress}%`}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || files.length === 0}
      >
        {isSubmitting
          ? 'Analizando…'
          : files.length <= 1
          ? 'Analizar'
          : `Analizar ${files.length} documentos`}
      </button>
    </form>
  );
}