import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const schemas = [
  "analytics",
  "auth",
  "consultation",
  "content",
  "general",
  "jobs",
  "payment",
  "tariff",
];

function identifier(name: string, value: string | undefined) {
  if (!value || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${name} must be a safe PostgreSQL role identifier`);
  return value;
}

function literal(value: string | undefined, name: string) {
  if (!value || value.length < 20 || /replace|change-me|example|your-/i.test(value)) {
    throw new Error(`${name} must contain at least 20 non-placeholder characters`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

async function ensureRole(role: string, password: string) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
  const attributes = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD ${password}`;
  if (rows[0]?.exists) await prisma.$executeRawUnsafe(`ALTER ROLE "${role}" WITH ${attributes}`);
  else await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" WITH ${attributes}`);

  // A reused role may have accumulated membership in a privileged role. Role
  // attributes alone do not remove the ability to SET ROLE, so explicitly
  // revoke every membership before granting the Spottex permissions below.
  const memberships = await prisma.$queryRaw<Array<{ grantedRole: string }>>`
    SELECT parent.rolname AS "grantedRole"
    FROM pg_auth_members membership
    JOIN pg_roles child ON child.oid = membership.member
    JOIN pg_roles parent ON parent.oid = membership.roleid
    WHERE child.rolname = ${role}
  `;
  for (const membership of memberships) {
    await prisma.$executeRawUnsafe(`REVOKE "${membership.grantedRole.replaceAll('"', '""')}" FROM "${role}"`);
  }
}

async function main() {
  const appRole = identifier("SPOTTEX_APP_DB_USER", process.env.SPOTTEX_APP_DB_USER);
  const backupRole = identifier("SPOTTEX_BACKUP_DB_USER", process.env.SPOTTEX_BACKUP_DB_USER);
  const [identity] = await prisma.$queryRaw<Array<{
    currentUser: string;
    sessionUser: string;
    databaseOwner: string;
  }>>`
    SELECT
      current_user AS "currentUser",
      session_user AS "sessionUser",
      pg_get_userbyid(db.datdba) AS "databaseOwner"
    FROM pg_database db
    WHERE db.datname = current_database()
  `;
  if (!identity) throw new Error("Could not determine PostgreSQL migration principals");
  if (appRole === backupRole) {
    throw new Error("SPOTTEX_APP_DB_USER and SPOTTEX_BACKUP_DB_USER must be different roles");
  }
  const privilegedPrincipals = new Set([
    identity.currentUser,
    identity.sessionUser,
    identity.databaseOwner,
  ]);
  for (const [name, role] of [["SPOTTEX_APP_DB_USER", appRole], ["SPOTTEX_BACKUP_DB_USER", backupRole]] as const) {
    if (privilegedPrincipals.has(role)) {
      throw new Error(`${name} must differ from the migration, session and database owner roles`);
    }
  }
  await ensureRole(appRole, literal(process.env.SPOTTEX_APP_DB_PASSWORD, "SPOTTEX_APP_DB_PASSWORD"));
  await ensureRole(backupRole, literal(process.env.SPOTTEX_BACKUP_DB_PASSWORD, "SPOTTEX_BACKUP_DB_PASSWORD"));
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const databaseName = database[0]?.name.replaceAll('"', '""');
  if (!databaseName) throw new Error("Could not determine PostgreSQL database name");
  for (const role of [appRole, backupRole]) {
    const owned = await prisma.$queryRawUnsafe<Array<{ kind: string; name: string }>>(`
      SELECT 'database' AS kind, datname AS name FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = $1)
      UNION ALL
      SELECT 'schema', nspname FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
      UNION ALL
      SELECT 'relation', namespace.nspname || '.' || relation.relname
        FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1) AND namespace.nspname = ANY($2::text[])
      UNION ALL
      SELECT 'function', namespace.nspname || '.' || routine.proname
        FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
       WHERE routine.proowner = (SELECT oid FROM pg_roles WHERE rolname = $1) AND namespace.nspname = ANY($2::text[])
      UNION ALL
      SELECT 'type', namespace.nspname || '.' || type.typname
        FROM pg_type type JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
       WHERE type.typowner = (SELECT oid FROM pg_roles WHERE rolname = $1) AND namespace.nspname = ANY($2::text[])
      LIMIT 1
    `, role, [...schemas, "public"]);
    if (owned[0]) {
      throw new Error(`${role} owns ${owned[0].kind} ${owned[0].name}; reassign ownership to the migration role before enforcing least privilege`);
    }
  }
  await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON DATABASE "${databaseName}" FROM "${appRole}", "${backupRole}"`);
  await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${databaseName}" TO "${appRole}", "${backupRole}"`);
  for (const schema of schemas) {
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "${schema}" FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "${schema}" FROM PUBLIC`);
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA "${schema}" FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${appRole}"`);
    await prisma.$executeRawUnsafe(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${appRole}"`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${backupRole}"`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${backupRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL PRIVILEGES ON TABLES FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL PRIVILEGES ON SEQUENCES FROM "${appRole}", "${backupRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL PRIVILEGES ON FUNCTIONS FROM "${appRole}", "${backupRole}", PUBLIC`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${appRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO "${backupRole}"`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT ON SEQUENCES TO "${backupRole}"`);
  }
  // Prisma keeps its migration ledger in `public` even though all domain
  // models use explicit schemas. pg_dump locks every included table, so the
  // read-only backup role must be able to read that ledger as well. The app
  // role deliberately receives no additional privileges in `public`.
  await prisma.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA "public" FROM PUBLIC`);
  await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "${appRole}", "${backupRole}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM "${appRole}", "${backupRole}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public" FROM "${appRole}", "${backupRole}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM "${appRole}", "${backupRole}"`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "public" TO "${backupRole}"`);
  await prisma.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA "public" TO "${backupRole}"`);
  await prisma.$executeRawUnsafe(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "${backupRole}"`);
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT ON TABLES TO "${backupRole}"`);
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT ON SEQUENCES TO "${backupRole}"`);
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => { console.error(error); process.exit(1); });
