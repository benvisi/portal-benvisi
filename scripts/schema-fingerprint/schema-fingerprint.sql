-- =============================================================================
-- Portal Benvisi — deterministic schema fingerprint (READ-ONLY)
--
-- Emits one row per schema object as (section, category, object_key, value),
-- plus per-category and per-section md5 digests, so two databases can be
-- compared object-by-object with scripts/schema-fingerprint/compare.mjs.
-- See README.md in this directory for how to run and interpret it.
--
-- READ-ONLY: a single SELECT over pg_catalog. The only other statement is
-- SET LOCAL search_path, which lasts for this transaction only and changes
-- nothing in the database. It is required: pg_get_*def()/format_type() print
-- schema-qualified names only for schemas NOT on the search_path, so pinning
-- it to pg_catalog makes every definition fully qualified and identical
-- regardless of the client's settings. Run in ONE transaction
-- (psql --single-transaction, or the Supabase SQL editor); the 'meta' row
-- records the effective search_path and compare.mjs rejects output where it
-- is not 'pg_catalog'.
--
-- Sections:
--   app      Portal-owned state. Every difference is a divergence unless it
--            is listed in allowlist.tsv with a reason.
--   platform Supabase platform-managed state that is visible in this
--            database (platform extensions, Supabase event triggers, the
--            auto-RLS feature, supabase_admin default ACLs, grants to
--            non-application roles). Still compared — differences need an
--            explicit allowlist entry — but kept separate from app state.
--   info     Informational only, never fails a comparison (exact function
--            source hashes, comments).
--   meta     Format version and the effective search_path (validated, not
--            compared).
--   ~digest  md5 per section.category and per section (section.*), over the
--            sorted "object_key<TAB>value" lines.
--
-- Deliberately NOT captured (noise, not schema): OIDs, owners, timestamps,
-- statistics, physical storage, sequence current values, any table data.
-- Objects that are members of an extension (e.g. the ~47 citext functions in
-- public) are represented by that extension's row (with a member count),
-- not listed individually.
--
-- Classification lists below (portal_extensions, platform_public_functions,
-- platform_event_triggers, app_roles) are the ONLY places that decide
-- app vs platform. Anything not listed is treated as app state, so unknown
-- objects are never silently hidden.
-- =============================================================================

set local search_path to pg_catalog;

select section, category, object_key, value
from (
  with
  app_roles(rolname) as (
    values ('anon'), ('authenticated'), ('service_role'), ('PUBLIC')
  ),
  portal_extensions(extname) as (
    values ('citext'), ('pgcrypto')
  ),
  platform_public_functions(proname) as (
    -- Supabase "auto-enable RLS on new tables" feature; lives in public.
    values ('rls_auto_enable')
  ),
  platform_event_triggers(evtname) as (
    values ('ensure_rls'), ('issue_graphql_placeholder'), ('issue_pg_cron_access'),
           ('issue_pg_graphql_access'), ('issue_pg_net_access'),
           ('pgrst_ddl_watch'), ('pgrst_drop_watch')
  ),
  known_categories(section, category) as (
    values ('app', 'column'), ('app', 'constraint'), ('app', 'default_acl'),
           ('app', 'event_trigger'), ('app', 'extension'), ('app', 'function'),
           ('app', 'function_execute'), ('app', 'index'), ('app', 'policy'),
           ('app', 'schema_acl'), ('app', 'sequence'), ('app', 'table'),
           ('app', 'table_privilege'), ('app', 'trigger'), ('app', 'type'),
           ('platform', 'default_acl'), ('platform', 'event_trigger'),
           ('platform', 'extension'), ('platform', 'function'),
           ('platform', 'function_execute'), ('platform', 'other_grantee'),
           ('platform', 'server'),
           ('info', 'comment'), ('info', 'function_source_exact')
  ),
  pub as (
    select oid, nspowner, nspacl from pg_namespace where nspname = 'public'
  ),
  ext_member as (
    select classid, objid from pg_depend where deptype = 'e'
  ),
  rels as (
    select c.oid, c.relname, c.relkind, c.relowner, c.relacl,
           c.relrowsecurity, c.relforcerowsecurity, c.relpersistence, c.relispartition
    from pg_class c
    where c.relnamespace = (select oid from pub)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and not exists (select 1 from ext_member m
                      where m.classid = 'pg_class'::regclass and m.objid = c.oid)
  ),
  funcs as (
    select p.oid, p.proname, p.proowner, p.proacl, p.prosrc, p.prokind,
           p.prosecdef, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel,
           p.proconfig, l.lanname,
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fkey,
           case when p.proname in (select proname from platform_public_functions)
                then 'platform' else 'app' end as section
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    where p.pronamespace = (select oid from pub)
      and not exists (select 1 from ext_member m
                      where m.classid = 'pg_proc'::regclass and m.objid = p.oid)
  ),
  rel_acl as (
    select r.relname,
           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type || case when a.is_grantable then '*' else '' end as priv
    from rels r
    cross join lateral aclexplode(coalesce(
      r.relacl,
      acldefault(case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner)
    )) a
    where a.grantee <> r.relowner
  ),
  rel_grants as (
    select relname, grantee, string_agg(priv, ',' order by priv collate "C") as privs
    from rel_acl group by relname, grantee
  ),
  fn_acl as (
    select f.fkey, f.section,
           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type || case when a.is_grantable then '*' else '' end as priv
    from funcs f
    cross join lateral aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
    where a.grantee <> f.proowner
  ),
  schema_grants as (
    select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee,
           string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end,
                      ',' order by a.privilege_type collate "C") as privs
    from pub p
    cross join lateral aclexplode(coalesce(p.nspacl, acldefault('n'::"char", p.nspowner))) a
    where a.grantee <> p.nspowner
    group by a.grantee
  ),
  fp_raw(section, category, object_key, value) as (

    -- ---------------------------------------------------------------- meta
    select 'meta', 'format', 'version', '1'
    union all
    select 'meta', 'setting', 'search_path', current_setting('search_path')

    -- ------------------------------------------------------ platform.server
    union all
    select 'platform', 'server', 'postgres_major_version',
           (current_setting('server_version_num')::int / 10000)::text

    -- ---------------------------------------------------------- extensions
    union all
    select case when e.extname in (select extname from portal_extensions)
                then 'app' else 'platform' end,
           'extension', e.extname::text,
           'schema=' || n.nspname || ' | version=' || e.extversion
             || ' | members=' || (select count(*) from pg_depend d
                                  where d.refclassid = 'pg_extension'::regclass
                                    and d.refobjid = e.oid and d.deptype = 'e')::text
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace

    -- ---------------------------------------------------------- schema ACL
    union all
    select 'app', 'schema_acl', 'public',
           coalesce((select string_agg(sg.grantee || '=' || sg.privs, ';' order by sg.grantee collate "C")
                     from schema_grants sg
                     where sg.grantee in (select rolname from app_roles)), '(none)')

    -- -------------------------------------------------- tables (+ views etc)
    union all
    select 'app', 'table', r.relname::text,
           'kind=' || r.relkind::text || ' | persistence=' || r.relpersistence::text
             || ' | rls=' || r.relrowsecurity::text || ' | force_rls=' || r.relforcerowsecurity::text
             || ' | partition=' || r.relispartition::text
             || case when r.relkind in ('v', 'm')
                     then ' | viewdef_md5=' || md5(pg_get_viewdef(r.oid)) else '' end
    from rels r where r.relkind in ('r', 'p', 'v', 'm', 'f')

    -- ------------------------------------------------------------- columns
    union all
    select 'app', 'column', r.relname || '.' || a.attname,
           'pos=' || (row_number() over (partition by r.oid order by a.attnum))::text
             || ' | type=' || format_type(a.atttypid, a.atttypmod)
             || ' | notnull=' || a.attnotnull::text
             || ' | default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
             || ' | identity=' || a.attidentity::text
             || ' | generated=' || a.attgenerated::text
             || ' | collation=' || case when a.attcollation <> 0 and a.attcollation <> t.typcollation
                                        then co.collname::text else '' end
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    left join pg_collation co on co.oid = a.attcollation
    where r.relkind in ('r', 'p', 'v', 'm', 'f')

    -- -------------------------------------------------- constraints and FKs
    union all
    select 'app', 'constraint', r.relname || '.' || c.conname,
           'type=' || c.contype::text || ' | validated=' || c.convalidated::text
             || ' | def=' || pg_get_constraintdef(c.oid)
    from pg_constraint c join rels r on r.oid = c.conrelid

    -- ------------------------------------- standalone (non-constraint) indexes
    union all
    select 'app', 'index', ic.relname::text,
           'valid=' || i.indisvalid::text || ' | def=' || pg_get_indexdef(i.indexrelid)
    from pg_index i
    join rels r on r.oid = i.indrelid
    join pg_class ic on ic.oid = i.indexrelid
    where not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)

    -- ----------------------------------------------------------- sequences
    union all
    select 'app', 'sequence', r.relname::text,
           'type=' || format_type(s.seqtypid, null) || ' | start=' || s.seqstart::text
             || ' | increment=' || s.seqincrement::text || ' | min=' || s.seqmin::text
             || ' | max=' || s.seqmax::text || ' | cache=' || s.seqcache::text
             || ' | cycle=' || s.seqcycle::text
             || ' | owned_by=' || coalesce((
                  select oc.relname || '.' || oa.attname
                         || case when dep.deptype = 'i' then ' (identity)' else '' end
                  from pg_depend dep
                  join pg_class oc on oc.oid = dep.refobjid
                  join pg_attribute oa on oa.attrelid = dep.refobjid and oa.attnum = dep.refobjsubid
                  where dep.classid = 'pg_class'::regclass and dep.objid = r.oid
                    and dep.refclassid = 'pg_class'::regclass and dep.deptype in ('a', 'i')
                  limit 1), '')
    from rels r join pg_sequence s on s.seqrelid = r.oid

    -- ------------------------------------------------- types (non-table)
    union all
    select 'app', 'type', t.typname::text,
           case t.typtype
             when 'e' then 'enum=' || coalesce((select string_agg(en.enumlabel, ',' order by en.enumsortorder)
                                                from pg_enum en where en.enumtypid = t.oid), '')
             when 'd' then 'domain base=' || format_type(t.typbasetype, t.typtypmod)
                           || ' | notnull=' || t.typnotnull::text
                           || ' | default=' || coalesce(t.typdefault, '')
                           || ' | checks=' || coalesce((select string_agg(pg_get_constraintdef(dc.oid), ' AND '
                                                                         order by dc.conname collate "C")
                                                        from pg_constraint dc where dc.contypid = t.oid), '')
             else 'composite=' || coalesce((select string_agg(ca.attname || ' ' || format_type(ca.atttypid, ca.atttypmod),
                                                              ', ' order by ca.attnum)
                                            from pg_attribute ca
                                            where ca.attrelid = t.typrelid and ca.attnum > 0 and not ca.attisdropped), '')
           end
    from pg_type t
    where t.typnamespace = (select oid from pub)
      and t.typtype in ('e', 'd', 'c')
      and (t.typtype <> 'c' or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
      and not exists (select 1 from ext_member m where m.classid = 'pg_type'::regclass and m.objid = t.oid)

    -- ----------------------------------------------------------- functions
    union all
    select f.section, 'function', f.fkey,
           'kind=' || f.prokind::text || ' | lang=' || f.lanname
             || ' | args=' || pg_get_function_arguments(f.oid)
             || ' | returns=' || coalesce(pg_get_function_result(f.oid), '')
             || ' | secdef=' || f.prosecdef::text || ' | volatility=' || f.provolatile::text
             || ' | strict=' || f.proisstrict::text || ' | leakproof=' || f.proleakproof::text
             || ' | parallel=' || f.proparallel::text
             || ' | config=' || coalesce((select string_agg(x, ';' order by x collate "C")
                                          from unnest(f.proconfig) x), '')
             || ' | body_norm_md5=' || md5(btrim(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(replace(f.prosrc, chr(13), ''), E'/\\*.*?\\*/', '', 'g'),
                        '--[^' || chr(10) || ']*', '', 'g'),
                      E'\\s+', ' ', 'g'),
                    E'\\s*([(),;])\\s*', E'\\1', 'g')))
    from funcs f

    -- --------------------------------------------------- function EXECUTE
    union all
    select f.section, 'function_execute', f.fkey,
           coalesce((select string_agg(fa.grantee || '=' || fa.priv, ';' order by fa.grantee collate "C")
                     from fn_acl fa
                     where fa.fkey = f.fkey and fa.grantee in (select rolname from app_roles)), '(none)')
    from funcs f

    -- -------------------------------------------- table/sequence privileges
    union all
    select 'app', 'table_privilege', r.relname::text,
           coalesce((select string_agg(g.grantee || '=' || g.privs, ';' order by g.grantee collate "C")
                     from rel_grants g
                     where g.relname = r.relname and g.grantee in (select rolname from app_roles)), '(none)')
    from rels r

    -- ------------------ grants to roles outside app_roles (never dropped)
    union all
    select 'platform', 'other_grantee', 'schema:public:' || sg.grantee, sg.privs
    from schema_grants sg where sg.grantee not in (select rolname from app_roles)
    union all
    select 'platform', 'other_grantee', 'relation:' || g.relname || ':' || g.grantee, g.privs
    from rel_grants g where g.grantee not in (select rolname from app_roles)
    union all
    select 'platform', 'other_grantee', 'function:' || fa.fkey || ':' || fa.grantee,
           string_agg(fa.priv, ',' order by fa.priv collate "C")
    from fn_acl fa where fa.grantee not in (select rolname from app_roles)
    group by fa.fkey, fa.grantee

    -- ------------------------------------------------------------ triggers
    union all
    select 'app', 'trigger', r.relname || '.' || tg.tgname,
           'enabled=' || tg.tgenabled::text || ' | def=' || pg_get_triggerdef(tg.oid)
    from pg_trigger tg join rels r on r.oid = tg.tgrelid
    where not tg.tgisinternal

    -- ------------------------------------------------------ event triggers
    union all
    select case when et.evtname in (select evtname from platform_event_triggers)
                then 'platform' else 'app' end,
           'event_trigger', et.evtname::text,
           'event=' || et.evtevent || ' | function=' || et.evtfoid::regproc::text
             || ' | tags=' || coalesce((select string_agg(tag, ',' order by tag collate "C")
                                        from unnest(et.evttags) tag), '')
             || ' | enabled=' || et.evtenabled::text
    from pg_event_trigger et

    -- ------------------------------------------------------------ policies
    union all
    select 'app', 'policy', r.relname || '.' || pol.polname,
           'permissive=' || pol.polpermissive::text || ' | cmd=' || pol.polcmd::text
             || ' | roles=' || coalesce((select string_agg(rn, ',' order by rn collate "C") from (
                  select case when rid = 0 then 'PUBLIC' else pg_get_userbyid(rid)::text end as rn
                  from unnest(pol.polroles) rid) x), '')
             || ' | using=' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
             || ' | check=' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    from pg_policy pol join rels r on r.oid = pol.polrelid

    -- -------------------------------------------------------- default ACLs
    union all
    select case when pg_get_userbyid(da.defaclrole) = 'postgres' then 'app' else 'platform' end,
           'default_acl',
           pg_get_userbyid(da.defaclrole) || '/' || case when da.defaclnamespace = 0 then '*' else 'public' end
             || '/' || case da.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                                             when 'f' then 'functions' when 'T' then 'types'
                                             when 'n' then 'schemas' else da.defaclobjtype::text end,
           coalesce((select string_agg(g, ';' order by g collate "C") from (
             select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end
                    || '=' || string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end,
                                         ',' order by a.privilege_type collate "C") as g
             from aclexplode(da.defaclacl) a
             where a.grantee <> da.defaclrole
             group by a.grantee) s), '(none)')
    from pg_default_acl da
    where da.defaclnamespace in (0, (select oid from pub))

    -- ------------------------------------------- info: exact source + notes
    union all
    select 'info', 'function_source_exact', f.fkey, md5(replace(f.prosrc, chr(13), ''))
    from funcs f
    union all
    select 'info', 'comment', 'relation:' || r.relname, md5(ds.description)
    from rels r join pg_description ds
      on ds.classoid = 'pg_class'::regclass and ds.objoid = r.oid and ds.objsubid = 0
    union all
    select 'info', 'comment', 'column:' || r.relname || '.' || a.attname, md5(ds.description)
    from rels r
    join pg_description ds on ds.classoid = 'pg_class'::regclass and ds.objoid = r.oid and ds.objsubid > 0
    join pg_attribute a on a.attrelid = r.oid and a.attnum = ds.objsubid
    union all
    select 'info', 'comment', 'function:' || f.fkey, md5(ds.description)
    from funcs f join pg_description ds
      on ds.classoid = 'pg_proc'::regclass and ds.objoid = f.oid and ds.objsubid = 0
  ),
  fp as (
    -- Tabs/newlines inside deparsed definitions would break the TSV format;
    -- collapse them (identically on both sides of any comparison).
    select section, category, object_key, regexp_replace(value, E'[\\t\\n\\r]+', ' ', 'g') as value
    from fp_raw
  ),
  digests as (
    select '~digest'::text as section, k.section || '.' || k.category as category,
           'count=' || count(f.object_key)::text as object_key,
           md5(coalesce(string_agg(f.object_key || chr(9) || f.value, chr(10)
                                   order by f.object_key collate "C"), '')) as value
    from known_categories k
    left join fp f on f.section = k.section and f.category = k.category
    group by k.section, k.category
    union all
    select '~digest', f.section || '.*', 'count=' || count(*)::text,
           md5(string_agg(f.category || chr(9) || f.object_key || chr(9) || f.value, chr(10)
                          order by f.category collate "C", f.object_key collate "C"))
    from fp f where f.section in ('app', 'platform', 'info')
    group by f.section
  )
  select section, category, object_key, value from fp
  union all
  select section, category, object_key, value from digests
) fingerprint
order by section collate "C", category collate "C", object_key collate "C";
