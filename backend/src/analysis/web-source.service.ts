import { Injectable, Logger } from '@nestjs/common';
import { SearchQueryPlannerService } from './search-query-planner.service';
import type { ExternalSourceDocument } from './web-providers/web-provider.types';
import { createAllWebSearchProviders } from './web-providers/web-providers.registry';
import { deduplicateByUrlOrContent } from './web-providers/web-provider.utils';

export type { ExternalSourceDocument } from './web-providers/web-provider.types';

export type WebSearchOptions = {
  title?: string;
};

const maxCombinedResults = (() => {
  const n = Number(process.env.SEARCH_MAX_COMBINED_RESULTS ?? '36');
  return Number.isFinite(n) && n >= 10 ? Math.min(Math.floor(n), 60) : 36;
})();

const perProviderLimit = (() => {
  const n = Number(process.env.SEARCH_PER_PROVIDER_LIMIT ?? '4');
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 8) : 4;
})();

@Injectable()
export class WebSourceService {
  private readonly logger = new Logger(WebSourceService.name);
  private readonly providers = createAllWebSearchProviders();

  constructor(private readonly queryPlanner: SearchQueryPlannerService) {}

  /**
   * Búsqueda externa ampliada: múltiples consultas × múltiples proveedores.
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
