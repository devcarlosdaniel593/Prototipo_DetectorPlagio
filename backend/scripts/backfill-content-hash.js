/**
 * Paso 3 — Calcula la huella (contentHash) de los documentos antiguos
 * y muestra qué documentos están repetidos. NO borra nada.
 *
 * Uso (desde la carpeta backend):
 *   node scripts/backfill-content-hash.js
 */
const { createHash } = require('crypto');
const { PrismaClient } = require('@prisma/client');

// Misma fórmula que computeContentHash() en src/documents/documents.service.ts
function computeContentHash(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const pending = await prisma.document.findMany({
      where: { contentHash: null },
      select: { id: true, content: true },
    });

    let updated = 0;
    for (const doc of pending) {
      if (!doc.content || !doc.content.trim()) continue;
      await prisma.document.update({
        where: { id: doc.id },
        data: { contentHash: computeContentHash(doc.content) },
      });
      updated += 1;
    }
    console.log(`Huellas calculadas: ${updated} de ${pending.length} documentos pendientes.`);

    const all = await prisma.document.findMany({
      where: { contentHash: { not: null } },
      select: {
        id: true,
        title: true,
        contentHash: true,
        analysis: { select: { referenceLabel: true } },
      },
      orderBy: { id: 'asc' },
    });

    const groups = new Map();
    for (const doc of all) {
      const list = groups.get(doc.contentHash) || [];
      list.push(doc);
      groups.set(doc.contentHash, list);
    }

    const duplicated = [...groups.values()].filter((list) => list.length > 1);
    if (duplicated.length === 0) {
      console.log('No hay documentos repetidos.');
      return;
    }

    const extra = duplicated.reduce((sum, list) => sum + list.length - 1, 0);
    console.log(
      `\nGrupos de documentos repetidos: ${duplicated.length} (${extra} copias de más)\n`,
    );
    duplicated.forEach((list, i) => {
      console.log(`Grupo ${i + 1}:`);
      for (const doc of list) {
        const label = doc.analysis?.referenceLabel ?? 'sin etiqueta';
        const metrics = doc.analysis ? 'con métricas' : 'sin métricas';
        console.log(`  id ${doc.id} | ${doc.title} | ${metrics} | ${label}`);
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
