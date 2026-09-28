/**
 * Vuelve a analizar TODOS los documentos del repositorio y actualiza sus métricas
 * (DocumentAnalysis). Las etiquetas de referencia NO se tocan.
 *
 * Por qué: cada documento se analizó al subirlo, comparándolo solo con los que
 * existían en ese momento. Después de la deduplicación y de los arreglos de los
 * Pasos 4 y 5, hay que recalcular todo contra el repositorio completo.
 *
 * Requisitos:
 *   - Backend compilado:  npm run build   (o tener npm run start:dev corriendo)
 *   - Microservicio Flask encendido (puerto 5000)
 *   - PostgreSQL encendido
 *
 * Uso (desde la carpeta backend):
 *   node scripts/reanalyze-all.js              → todos los documentos
 *   node scripts/reanalyze-all.js 5 12 34      → solo esos ids
 *
 * Tarda aprox. 20–60 s por documento (búsqueda web + análisis semántico).
 */
const fs = require('fs');
const path = require('path');

function distPath(...parts) {
  const candidates = [
    path.join(__dirname, '..', 'dist', ...parts),
    path.join(__dirname, '..', 'dist', 'src', ...parts),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No se encontró dist/. Ejecuta primero: npm run build');
  return found;
}

const PAUSE_BETWEEN_DOCS_MS = 2000; // respiro para las APIs web

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(distPath('app.module.js'));
  const { AnalysisService } = require(distPath('analysis', 'analysis.service.js'));
  const { DocumentAnalysisService } = require(
    distPath('evaluation', 'document-analysis.service.js'),
  );
  const { PrismaService } = require(distPath('prisma', 'prisma.service.js'));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const analysisService = app.get(AnalysisService);
    const documentAnalysisService = app.get(DocumentAnalysisService);

    const onlyIds = process.argv.slice(2).map(Number).filter(Number.isInteger);
    const docs = await prisma.document.findMany({
      where: onlyIds.length ? { id: { in: onlyIds } } : undefined,
      select: {
        id: true,
        title: true,
        analysis: { select: { overallSimilarity: true } },
      },
      orderBy: { id: 'asc' },
    });

    console.log(`Documentos a reanalizar: ${docs.length}\n`);
    let degraded = 0;
    let failed = 0;

    for (const [i, doc] of docs.entries()) {
      const before = doc.analysis?.overallSimilarity;
      const startedAt = Date.now();
      try {
        const result = await analysisService.analyzeDocument(doc.id);
        const elapsed = Date.now() - startedAt;
        await documentAnalysisService.saveFromAnalysisResult(doc.id, result, elapsed);
        if (result.semanticServiceStatus === 'degraded') degraded += 1;

        const detected = result.overallSimilarity >= 40 && result.summary.length > 0;
        console.log(
          `[${i + 1}/${docs.length}] id ${doc.id} | ${
            before != null ? before.toFixed(2) : '—'
          }% → ${result.overallSimilarity.toFixed(2)}%${detected ? ' (similar)' : ''} | ` +
            `${(elapsed / 1000).toFixed(1)} s${
              result.semanticServiceStatus === 'degraded' ? ' | IA degradada' : ''
            } | ${doc.title}`,
        );
      } catch (error) {
        failed += 1;
        console.log(
          `[${i + 1}/${docs.length}] id ${doc.id} | ERROR: ${error.message || error}`,
        );
      }
      if (i < docs.length - 1) {
        await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_DOCS_MS));
      }
    }

    console.log(
      `\nListo. Errores: ${failed}. Con IA semántica degradada: ${degraded}.` +
        (degraded ? ' (revisa que Flask esté encendido y repite esos ids)' : ''),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
