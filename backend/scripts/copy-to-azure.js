/**
 * Copia los datos de la base LOCAL a la base de AZURE (misma estructura).
 * Copia usuarios, documentos y métricas conservando los mismos ids y las
 * etiquetas de referencia. No modifica la base local.
 *
 * Requisitos:
 *   - En Azure ya se aplicaron las migraciones (npx prisma migrate deploy).
 *   - La variable AZURE_DATABASE_URL tiene la cadena de conexión de Azure.
 *   - La base local se lee del archivo backend/.env (DATABASE_URL).
 *
 * Uso (desde la carpeta backend):
 *   node scripts/copy-to-azure.js           → simulación: solo cuenta los registros
 *   node scripts/copy-to-azure.js --apply   → copia los datos
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

function readLocalUrlFromEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error('No se encontró DATABASE_URL en backend/.env');
  return match[1].trim();
}

function hostOf(url) {
  const m = url.match(/@([^:/?]+)/);
  return m ? m[1] : '(desconocido)';
}

async function counts(prisma) {
  const [users, documents, analyses, labeled] = await Promise.all([
    prisma.user.count(),
    prisma.document.count(),
    prisma.documentAnalysis.count(),
    prisma.documentAnalysis.count({ where: { referenceLabel: { not: null } } }),
  ]);
  return { users, documents, analyses, labeled };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function main() {
  const localUrl = readLocalUrlFromEnvFile();
  const azureUrl = process.env.AZURE_DATABASE_URL;
  if (!azureUrl) {
    throw new Error('Define primero la variable AZURE_DATABASE_URL (ver instrucciones).');
  }
  if (hostOf(localUrl) === hostOf(azureUrl)) {
    throw new Error('Origen y destino son el mismo servidor. Revisa las variables.');
  }

  const source = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const target = new PrismaClient({ datasources: { db: { url: azureUrl } } });

  try {
    console.log(`Origen  (local): ${hostOf(localUrl)}`);
    console.log(`Destino (Azure): ${hostOf(azureUrl)}\n`);

    const before = await counts(source);
    const targetBefore = await counts(target);
    console.log('Local :', before);
    console.log('Azure :', targetBefore);

    if (targetBefore.users || targetBefore.documents || targetBefore.analyses) {
      console.log(
        '\nLa base de Azure ya tiene datos. Para no duplicar, no se copia nada.',
      );
      return;
    }

    if (!APPLY) {
      console.log('\nSIMULACIÓN: no se copió nada. Para copiar: node scripts/copy-to-azure.js --apply');
      return;
    }

    const users = await source.user.findMany({ orderBy: { id: 'asc' } });
    const documents = await source.document.findMany({ orderBy: { id: 'asc' } });
    const analyses = await source.documentAnalysis.findMany({ orderBy: { id: 'asc' } });

    // Todo o nada: si algo falla, Azure queda vacío como estaba
    await target.$transaction([
      target.user.createMany({ data: users }),
      ...chunk(documents, 10).map((part) => target.document.createMany({ data: part })),
      target.documentAnalysis.createMany({ data: analyses }),
    ]);

    // Los ids se copiaron tal cual: hay que mover los contadores (secuencias)
    // para que el próximo registro nuevo no choque con un id existente.
    for (const table of ['User', 'Document', 'DocumentAnalysis']) {
      await target.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "${table}"))`,
      );
    }

    const after = await counts(target);
    console.log('\nAzure después de copiar:', after);
    const ok =
      after.users === before.users &&
      after.documents === before.documents &&
      after.analyses === before.analyses &&
      after.labeled === before.labeled;
    console.log(ok ? '\nListo: los conteos coinciden.' : '\nATENCIÓN: los conteos no coinciden.');
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
