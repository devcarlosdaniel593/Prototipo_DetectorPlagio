import axios from 'axios';

/**
 * Cliente HTTP del backend NestJS. La URL base se toma de
 * REACT_APP_API_BASE_URL (se fija al compilar el frontend) o, si no existe,
 * de http://localhost:3000.
 */
const API = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000',
});

// ── Un solo documento (comportamiento original) ───────────────────────────
export const uploadDocument = (formData, { onUploadProgress } = {}) => {
  return API.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
};

// ── Hasta 10 documentos en un solo request ────────────────────────────────
// files: File[]  titles: string[]  userId: number
// onUploadProgress: callback estándar de axios
export const uploadDocumentBatch = (
  files,
  titles,
  userId,
  { onUploadProgress, persistToRepository = true } = {},
) => {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('titles', JSON.stringify(titles));
  formData.append('userId', String(userId));
  formData.append('persistToRepository', persistToRepository ? 'true' : 'false');

  return API.post('/documents/upload-batch', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
};

// GET /evaluation/report con un tiempo de espera de 60 s.
export const getEvaluationReport = () => {
  return API.get('/evaluation/report', { timeout: 60000 });
};

// ── Etiqueta de referencia de un documento (para precisión, recall y F1) ──
// label: 'similar' | 'original' | null
export const setReferenceLabel = (documentId, label) => {
  return API.patch(`/evaluation/documents/${documentId}/label`, { label });
};