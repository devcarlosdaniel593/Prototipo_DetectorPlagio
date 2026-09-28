import type { ExternalSourceDocument, WebSearchProvider } from './web-provider.types';
import {
  contactEmail,
  defaultHeaders,
  getWithRetry,
  hashString,
  rebuildOpenAlexAbstract,
} from './web-provider.utils';

export function createAllWebSearchProviders(): WebSearchProvider[] {
  return [
    createWikipediaProvider(),
    createOpenAlexProvider(),
    createSemanticScholarProvider(),
    createSerpApiGoogleScholarProvider(),
    createSerpApiProvider(),
    createDuckDuckGoProvider(),
    createZenodoProvider(),
    createHalProvider(),
  ];
}

function createWikipediaProvider(): WebSearchProvider {
  return {
    name: 'wikipedia',
    search: async (query, limit) => {
      const headers = defaultHeaders();
      const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}`;
      const searchResponse = await getWithRetry(url, { timeout: 8000, headers });
      const results =
        (searchResponse.data as { query?: { search?: Array<{ pageid: number; title: string }> } })
          .query?.search || [];
      if (!results.length) return [];

      const docs: ExternalSourceDocument[] = [];
      for (const item of results) {
        const extractUrl = `https://es.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&pageids=${item.pageid}&format=json&exsectionformat=plain&exsentences=15`;
        try {
          const extractResponse = await getWithRetry(extractUrl, { timeout: 8000, headers });
          const page = (
            extractResponse.data as {
              query?: { pages?: Record<string, { extract?: string; title?: string }> };
            }
          ).query?.pages?.[String(item.pageid)];
          const text = page?.extract?.trim() || '';
          if (text.length < 100) continue;
          docs.push({
            id: -(item.pageid || docs.length + 1),
            title: page?.title || item.title,
            content: text,
            sourceType: 'web',
            url: `https://es.wikipedia.org/?curid=${item.pageid}`,
            provider: 'wikipedia',
          });
        } catch {
          // ignorar
        }
      }
      return docs;
    },
  };
}

function createOpenAlexProvider(): WebSearchProvider {
  return {
    name: 'openalex',
    search: async (query, limit) => {
      // mailto: OpenAlex atiende en su "polite pool" (menos errores 429)
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=id,display_name,abstract_inverted_index,primary_location&mailto=${encodeURIComponent(contactEmail())}`;
      const response = await getWithRetry(url, {
        timeout: 8000,
        headers: defaultHeaders(),
      });
      const works =
        (response.data as {
          results?: Array<{
            id?: string;
            display_name?: string;
            abstract_inverted_index?: Record<string, number[]>;
            primary_location?: { landing_page_url?: string };
          }>;
        }).results || [];

      const docs: ExternalSourceDocument[] = [];
      for (const work of works) {
        const abstractText = rebuildOpenAlexAbstract(work.abstract_inverted_index);
        if (!abstractText || abstractText.length < 60) continue;
        docs.push({
          id: -Math.abs(hashString(work.id || work.display_name || `${docs.length}`)),
          title: work.display_name || 'OpenAlex work',
          content: abstractText,
          sourceType: 'web',
          url: work.primary_location?.landing_page_url || work.id,
          provider: 'openalex',
        });
      }
      return docs;
    },
  };
}

function createSemanticScholarProvider(): WebSearchProvider {
  return {
    name: 'semantic_scholar',
    search: async (query, limit) => {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 5)}&fields=title,abstract,url,year`;
      try {
        const response = await getWithRetry(url, {
          timeout: 12000,
          headers: defaultHeaders(),
        });
        const rows =
          (response.data as {
            data?: Array<{
              paperId?: string;
              title?: string;
              abstract?: string;
              url?: string;
              year?: number;
            }>;
          }).data || [];

        const docs: ExternalSourceDocument[] = [];
        for (const row of rows) {
          const abstract = (row.abstract || '').trim();
          if (abstract.length < 80) continue;
          const title = row.title || 'Paper (Semantic Scholar)';
          docs.push({
            id: -Math.abs(hashString(row.paperId || title + abstract.slice(0, 40))),
            title: row.year ? `${title} (${row.year})` : title,
            content: abstract,
            sourceType: 'web',
            url:
              row.url ||
              (row.paperId
                ? `https://www.semanticscholar.org/paper/${row.paperId}`
                : undefined),
            provider: 'semantic_scholar',
          });
        }
        return docs;
      } catch {
        return [];
      }
    },
  };
}

function createSerpApiGoogleScholarProvider(): WebSearchProvider {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { name: 'serpapi_google_scholar', search: async () => [] };
  }
  return {
    name: 'serpapi_google_scholar',
    search: async (query, limit) => {
      const url = `https://serpapi.com/search.json?engine=google_scholar&q=${encodeURIComponent(query)}&hl=es&num=${Math.min(limit, 5)}&api_key=${encodeURIComponent(apiKey)}`;
      try {
        const response = await getWithRetry(url, { timeout: 12000 });
        const results =
          (response.data as {
            organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
          }).organic_results || [];
        return results
          .filter((item) => (item.snippet || '').trim().length > 50)
          .map((item, idx) => ({
            id: -Math.abs(hashString(`${item.link || ''}-scholar-${idx}`)),
            title: item.title || 'Google Scholar (vía SerpAPI)',
            content: item.snippet || '',
            sourceType: 'web' as const,
            url: item.link,
            provider: 'serpapi_google_scholar' as const,
          }));
      } catch {
        return [];
      }
    },
  };
}

function createSerpApiProvider(): WebSearchProvider {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { name: 'serpapi', search: async () => [] };
  }
  return {
    name: 'serpapi',
    search: async (query, limit) => {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${limit}&hl=es&api_key=${encodeURIComponent(apiKey)}`;
      try {
        const response = await getWithRetry(url, { timeout: 7000 });
        const results =
          (response.data as {
            organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
          }).organic_results || [];
        return results
          .filter((item) => (item.snippet || '').trim().length > 60)
          .map((item, idx) => ({
            id: -Math.abs(hashString(`${item.link || ''}-${idx}`)),
            title: item.title || 'Resultado web',
            content: item.snippet || '',
            sourceType: 'web' as const,
            url: item.link,
            provider: 'serpapi' as const,
          }));
      } catch {
        return [];
      }
    },
  };
}

function createDuckDuckGoProvider(): WebSearchProvider {
  return {
    name: 'duckduckgo',
    search: async (query, limit) => {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      try {
        const response = await getWithRetry(url, {
          timeout: 8000,
          headers: defaultHeaders(),
        });
        const payload = response.data as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<{
            Text?: string;
            FirstURL?: string;
            Topics?: Array<{ Text?: string; FirstURL?: string }>;
          }>;
        };

        const docs: ExternalSourceDocument[] = [];
        if ((payload.AbstractText || '').trim().length > 60) {
          docs.push({
            id: -Math.abs(hashString(`ddg-abstract-${query}`)),
            title: payload.Heading || 'DuckDuckGo',
            content: payload.AbstractText!.trim(),
            sourceType: 'web',
            url: payload.AbstractURL,
            provider: 'duckduckgo',
          });
        }

        const flatTopics: Array<{ Text?: string; FirstURL?: string }> = [];
        for (const topic of payload.RelatedTopics || []) {
          if (topic.Topics?.length) flatTopics.push(...topic.Topics);
          else flatTopics.push(topic);
        }

        for (const [idx, topic] of flatTopics.entries()) {
          if (docs.length >= limit) break;
          const text = (topic.Text || '').trim();
          if (text.length < 60) continue;
          docs.push({
            id: -Math.abs(hashString(`ddg-${query}-${idx}`)),
            title: text.slice(0, 80),
            content: text,
            sourceType: 'web',
            url: topic.FirstURL,
            provider: 'duckduckgo',
          });
        }
        return docs.slice(0, limit);
      } catch {
        return [];
      }
    },
  };
}

function createZenodoProvider(): WebSearchProvider {
  return {
    name: 'zenodo',
    search: async (query, limit) => {
      const url = `https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${Math.min(limit, 5)}&sort=bestmatch`;
      try {
        const response = await getWithRetry(url, { timeout: 10000, headers: defaultHeaders() });
        const hits =
          (response.data as {
            hits?: {
              hits?: Array<{
                id?: number;
                metadata?: { title?: string; description?: string };
                links?: { html?: string };
              }>;
            };
          }).hits?.hits || [];

        const docs: ExternalSourceDocument[] = [];
        for (const hit of hits) {
          const title = hit.metadata?.title || 'Registro Zenodo';
          const description = (hit.metadata?.description || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (description.length < 60) continue;
          docs.push({
            id: -Math.abs(hashString(`zenodo-${hit.id ?? docs.length}`)),
            title,
            content: description.slice(0, 1200),
            sourceType: 'web',
            url: hit.links?.html || `https://zenodo.org/record/${hit.id}`,
            provider: 'zenodo',
          });
        }
        return docs;
      } catch {
        return [];
      }
    },
  };
}

function createHalProvider(): WebSearchProvider {
  return {
    name: 'hal',
    search: async (query, limit) => {
      const url = `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(query)}&rows=${Math.min(limit, 5)}&fl=title_s,abstract_s,uri_s&wt=json`;
      try {
        const response = await getWithRetry(url, { timeout: 10000, headers: defaultHeaders() });
        const docsRaw =
          (response.data as {
            response?: {
              docs?: Array<{
                title_s?: string[];
                abstract_s?: string[];
                uri_s?: string[];
              }>;
            };
          }).response?.docs || [];

        const docs: ExternalSourceDocument[] = [];
        for (const doc of docsRaw) {
          const title = doc.title_s?.[0] || 'Documento HAL';
          const abstract = (doc.abstract_s?.[0] || '').trim();
          if (abstract.length < 60) continue;
          docs.push({
            id: -Math.abs(hashString(`hal-${doc.uri_s?.[0] ?? docs.length}`)),
            title,
            content: abstract.slice(0, 1200),
            sourceType: 'web',
            url: doc.uri_s?.[0],
            provider: 'hal',
          });
        }
        return docs;
      } catch {
        return [];
      }
    },
  };
}
