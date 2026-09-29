export type WebProviderName =
  | 'openalex'
  | 'crossref'
  | 'semantic_scholar'
  | 'serpapi'
  | 'serpapi_google_scholar'
  | 'zenodo'
  | 'hal';

export type ExternalSourceDocument = {
  id: number;
  title: string;
  content: string;
  sourceType: 'web';
  url?: string;
  provider: WebProviderName;
};

export type WebSearchProvider = {
  name: WebProviderName;
  search(query: string, limit: number): Promise<ExternalSourceDocument[]>;
};
