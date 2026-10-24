import {db} from './db';
// Production must use separate, limited credentials. Never ship a bypass flag.
export async function assertRuntimeAccess(kind:'staff'|'owner'){
  if(process.env.NODE_ENV!=='production')return;
  const rows=await db.$queryRaw<{unsafe:boolean;keys:boolean;settings:boolean;roles:boolean;auditRewrite:boolean;ownsTables:boolean}[]>`
    SELECT (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
      OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neon_superuser' AND pg_has_role(current_user,oid,'MEMBER')) AS unsafe,
      has_table_privilege(current_user,format('%I.%I',current_schema(),'OwnerCredential'),'SELECT') AS keys,
      has_table_privilege(current_user,format('%I.%I',current_schema(),'PlatformConfig'),'UPDATE') AS settings,
      has_column_privilege(current_user,format('%I.%I',current_schema(),'User'),'role','UPDATE') AS roles,
      has_table_privilege(current_user,format('%I.%I',current_schema(),'OwnerAudit'),'UPDATE,DELETE') AS "auditRewrite",
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname=current_schema() AND c.relname IN ('User','OwnerIdentity','OwnerCredential','OwnerAudit') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS "ownsTables"`;
  const access=rows[0];
  if(!access||access.unsafe||access.ownsTables||access.auditRewrite||(kind==='staff'&&(access.keys||access.settings||access.roles))||(kind==='owner'&&(!access.keys||!access.settings||!access.roles)))throw new Error('Configure the restricted PostgreSQL runtime role before enabling this application.');
}
