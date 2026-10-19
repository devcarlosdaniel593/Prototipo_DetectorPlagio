import { Injectable, Logger } from '@nestjs/common';
import { SearchQueryPlannerService } from './search-query-planner.service';
import type { ExternalSourceDocument } from './web-providers/web-provider.types';
import { createAllWebSearchProviders } from './web-providers/web-providers.registry';
import { deduplicateByUrlOrContent } from './web-providers/web-provider.utils';

export type { ExternalSourceDocument } from './web-providers/web-provider.types';

export type WebSearchOptions = {
  title?: string;
};

// SEARCH_MAX_COMBINED_RESULTS: máximo de fuentes web por análisis (10–60, por defecto 36).
// SEARCH_PER_PROVIDER_LIMIT: resultados pedidos a cada proveedor por consulta (2–8, por defecto 4).
const maxCombinedResults = (() => {
  const n = Number(process.env.SEARCH_MAX_COMBINED_RESULTS ?? '36');
  return Number.isFinite(n) && n >= 10 ? Math.min(Math.floor(n), 60) : 36;
})();

const perProviderLimit = (() => {
  const n = Number(process.env.SEARCH_PER_PROVIDER_LIMIT ?? '4');
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 8) : 4;
})();

/**
 * Obtiene fuentes externas (resúmenes de artículos académicos) para comparar
 * con el documento. Usa SearchQueryPlannerService para generar las consultas
 * y los proveedores de web-providers.registry.ts para ejecutarlas.
 */
@Injectable()
export class WebSourceService {
  private readonly logger = new Logger(WebSourceService.name);
  private readonly providers = createAllWebSearchProviders();

  constructor(private readonly queryPlanner: SearchQueryPlannerService) {}

  /**
   * Búsqueda externa ampliada: múltiples consultas × múltiples proveedores.
   *
   * Las consultas se ejecutan una tras otra; dentro de cada consulta, todos
   * los proveedores se llaman en paralelo (Promise.allSettled), de modo que
   * el fallo de uno no afecta a los demás. Si una consulta no devuelve nada,
   * se reintenta con sus 3 primeras palabras. Al final se deduplica por URL
   * (o por contenido) y se limita a SEARCH_MAX_COMBINED_RESULTS.
   *
   * @param targetText Texto completo del documento.
   * @param options.title Título del documento (se usa como consulta adicional).
   * @returns Fuentes externas con id negativo y sourceType 'web'.
   */
  async searchRelevantSources(
    targetText: string,
    options: WebSearchOptions = {},
  ): Promise<ExternalSourceDocument[]> {
    const plan = await this.queryPlanner.planQueries(targetText, options.title);
    const queries = plan.queries.length
      ? plan.queries
      : [this.queryPlanner.buildLegacySingleQuery(targetText)].filter(Boolean);

    if (!queries.length) return [];

    this.logger.log(
      `Búsqueda multi-query (${queries.length}): ${queries.map((q) => `"${q}"`).join(' | ')}`,
    );

    const merged: ExternalSourceDocument[] = [];

    for (const query of queries) {
      let batch = await this.runSearchForQuery(query);
      if (!batch.length && query.includes(' ')) {
        const simplified = query.split(' ').slice(0, 3).join(' ');
        this.logger.warn(`Sin resultados para "${query}", reintento: "${simplified}"`);
        batch = await this.runSearchForQuery(simplified);
      }
      merged.push(...batch);
    }

    const deduplicated = deduplicateByUrlOrContent(merged).slice(0, maxCombinedResults);
    this.logger.log(
      `Fuentes web combinadas: ${deduplicated.length} (proveedores activos: ${this.providers.length})`,
    );
    return deduplicated;
  }

  /** @deprecated Usar SearchQueryPlannerService — se mantiene por compatibilidad. */
  extractSearchQuery(text: string): string {
    return this.queryPlanner.buildLegacySingleQuery(text);
  }

  private async runSearchForQuery(query: string): Promise<ExternalSourceDocument[]> {
    const results = await Promise.allSettled(
      this.providers.map((provider) =>
        provider.search(query, perProviderLimit),
      ),
    );

    const merged: ExternalSourceDocument[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const providerName = this.providers[i].name;
      if (result.status === 'fulfilled') {
        if (result.value.length) {
          this.logger.log(`${providerName} ["${query.slice(0, 40)}…"]: ${result.value.length}`);
        }
        merged.push(...result.value);
      } else {
        this.logger.warn(`${providerName}: falló — ${result.reason}`);
      }
    }
    return merged;
  }
}
