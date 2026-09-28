/**
 * Paso 6 — Cifra las contraseñas que están guardadas en texto plano.
 *
 * Por defecto solo muestra cuántas hay (simulación). Para aplicar:
 *   node scripts/hash-existing-passwords.js --apply
 *
 * Después de aplicarlo, la contraseña original ya no se puede leer desde la BD
 * (es el objetivo). Anótala antes si la necesitas.
 */
const { randomBytes, scryptSync } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

// Mismo formato que src/users/password.util.ts: scrypt$<sal>$<hash>
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, password: true },
    });
    const plain = users.filter((u) => !u.password.startsWith('scrypt$'));

    console.log(`Usuarios: ${users.length} | con contraseña en texto plano: ${plain.length}`);
    plain.forEach((u) => console.log(`  id ${u.id} | ${u.email}`));

    if (!APPLY) {
      console.log('\nSIMULACIÓN: no se cambió nada. Para aplicar: node scripts/hash-existing-passwords.js --apply');
      return;
    }

    for (const u of plain) {
      await prisma.user.update({
        where: { id: u.id },
        data: { password: hashPassword(u.password) },
      });
    }
    console.log(`\nListo: ${plain.length} contraseña(s) cifrada(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
