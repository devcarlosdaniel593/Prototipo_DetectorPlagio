export type WebProviderName =
  | 'openalex'
  | 'crossref'
  | 'semantic_scholar'
  | 'serpapi'
  | 'serpapi_google_scholar'
  | 'zenodo'
  | 'hal';

/**
 * Resultado normalizado de cualquier proveedor. `content` es el resumen o
 * fragmento disponible (no el texto completo de la obra). `id` es negativo
 * para no coincidir con los ids de la tabla Document.
 */
export type ExternalSourceDocument = {
  id: number;
  title: string;
  content: string;
  sourceType: 'web';
  url?: string;
  provider: WebProviderName;
};

/** Contrato común de los proveedores: buscar `query` y devolver hasta `limit` resultados. */
export type WebSearchProvider = {
  name: WebProviderName;
  search(query: string, limit: number): Promise<ExternalSourceDocument[]>;
};
