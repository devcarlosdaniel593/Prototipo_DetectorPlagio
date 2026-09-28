/**
 * Paso 3 — Elimina los documentos repetidos (mismo contentHash).
 *
 * Regla: en cada grupo se conserva el documento con el id más bajo (el original)
 * y se eliminan las copias. Si el original no tiene etiqueta de referencia y
 * alguna copia sí, la etiqueta pasa al original.
 *
 * Por defecto NO borra nada (simulación). Para aplicar los cambios:
 *   node scripts/dedupe-documents.js --apply
 *
 * Antes de borrar guarda una copia de seguridad en
 *   backups/dedupe-<fecha>.json  (documentos y métricas eliminados).
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

async function main() {
  const prisma = new PrismaClient();
  try {
    const docs = await prisma.document.findMany({
      where: { contentHash: { not: null } },
      include: { analysis: true },
      orderBy: { id: 'asc' },
    });

    const groups = new Map();
    for (const doc of docs) {
      const list = groups.get(doc.contentHash) || [];
      list.push(doc);
      groups.set(doc.contentHash, list);
    }
    const duplicated = [...groups.values()].filter((list) => list.length > 1);

    if (duplicated.length === 0) {
      console.log('No hay documentos repetidos. Nada que hacer.');
      return;
    }

    const toDelete = [];
    const labelMoves = [];
    for (const [keep, ...copies] of duplicated) {
      toDelete.push(...copies);
      const keepLabel = keep.analysis?.referenceLabel ?? null;
      const copyLabel =
        copies.find((c) => c.analysis?.referenceLabel)?.analysis
          ?.referenceLabel ?? null;
      if (!keepLabel && copyLabel && keep.analysis) {
        labelMoves.push({ documentId: keep.id, label: copyLabel });
      }
      console.log(
        `Se conserva id ${keep.id} (${keep.title}) | se eliminan: ${copies
          .map((c) => c.id)
          .join(', ')}`,
      );
    }

    const total = await prisma.document.count();
    console.log(
      `\nDocumentos: ${total} → ${total - toDelete.length} (se eliminan ${toDelete.length}).`,
    );
    labelMoves.forEach((m) =>
      console.log(`Etiqueta "${m.label}" se traslada al documento ${m.documentId}.`),
    );

    if (!APPLY) {
      console.log(
        '\nSIMULACIÓN: no se borró nada. Para aplicar: node scripts/dedupe-documents.js --apply',
      );
      return;
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `dedupe-${stamp}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify({ deleted: toDelete, labelMoves }, null, 2),
      'utf8',
    );
    console.log(`\nCopia de seguridad: ${backupFile}`);

    await prisma.$transaction([
      ...labelMoves.map((m) =>
        prisma.documentAnalysis.update({
          where: { documentId: m.documentId },
          data: { referenceLabel: m.label },
        }),
      ),
      // Las métricas (DocumentAnalysis) se borran en cascada.
      prisma.document.deleteMany({
        where: { id: { in: toDelete.map((d) => d.id) } },
      }),
    ]);

    console.log(`Listo: ${toDelete.length} copias eliminadas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
