/**
 * Paso 4 — Prueba la estilometría sobre los documentos del repositorio
 * SIN volver a analizarlos ni modificar la base de datos.
 *
 * Requiere el backend compilado (npm run build, o tener corriendo npm run start:dev).
 * Uso (desde la carpeta backend):
 *   node scripts/stylometry-report.js
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function loadStylometryService() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'analysis', 'stylometry.service.js'),
    path.join(__dirname, '..', 'dist', 'src', 'analysis', 'stylometry.service.js'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('No se encontró dist/. Ejecuta primero: npm run build');
  }
  return require(found).StylometryService;
}

async function main() {
  const StylometryService = loadStylometryService();
  const stylometry = new StylometryService();
  const prisma = new PrismaClient();

  try {
    const docs = await prisma.document.findMany({
      select: { id: true, title: true, content: true },
      orderBy: { id: 'asc' },
    });

    let withAnomalies = 0;
    for (const doc of docs) {
      const text = doc.content || '';
      const words = text.split(/\s+/).filter(Boolean).length;
      const result = stylometry.analyze(text, []);
      if (result.anomalies.length > 0) withAnomalies += 1;
      console.log(
        `id ${String(doc.id).padStart(3)} | ${words
          .toString()
          .padStart(6)} palabras | consistencia ${String(
          result.consistencyScore,
        ).padStart(6)} | anomalías ${result.anomalies.length} | ${doc.title}`,
      );
      for (const a of result.anomalies.slice(0, 2)) {
        console.log(`      · segmento ${a.segmentIndex + 1} (${a.deviation}%): ${a.reason}`);
      }
    }
    console.log(
      `\nDocumentos con al menos una anomalía: ${withAnomalies} de ${docs.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
