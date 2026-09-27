import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { WebSourceService } from './web-source.service';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly webSourceService: WebSourceService,
  ) {}

  @Post('document/:id')
  analyzeByDocumentId(@Param('id', ParseIntPipe) id: number) {
    return this.analysisService.analyzeDocument(id);
  }

  /**
   * Endpoint de diagnóstico — muestra qué devuelven los proveedores web.
   * GET http://localhost:3000/analysis/web-sources?text=inteligencia artificial
   */
  @Get('web-sources')
  async diagnoseWebSources(@Query('text') text: string) {
    if (!text) {
      return { error: 'Debes enviar el parámetro ?text=...' };
    }
    const sources = await this.webSourceService.searchRelevantSources(text);
    return {
      total: sources.length,
      byProvider: sources.reduce((acc, s) => {
        acc[s.provider] = (acc[s.provider] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      sources: sources.map((s) => ({
        provider: s.provider,
        title: s.title,
        contentLength: s.content.length,
        contentPreview: s.content.slice(0, 150),
        url: s.url,
      })),
    };
  }
}