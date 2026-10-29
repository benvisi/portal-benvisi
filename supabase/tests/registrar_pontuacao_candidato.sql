-- Post-apply verification for registrar_pontuacao_candidato (Trello #10, 4A).
-- Run manually AFTER the migration is applied, as the postgres role in the SQL
-- editor. Everything runs inside one transaction that is rolled back, using a
-- synthetic execution + candidate; no real candidate is touched.
begin;

do $$
declare
  v_exec uuid;
  v_ok uuid;
  v_aprov uuid;
  v_before record;
  v_after record;
  v_u1 text := 'https://imagesa1.lacoste.com/t/one.jpg';
  v_u2 text := 'https://imagesa1.lacoste.com/t/two.jpg';
  v_gal jsonb := '[{"desktopUrl":"//imagesa1.lacoste.com/t/one.jpg","type":"image"},{"desktopUrl":"//imagesa1.lacoste.com/t/two.jpg","type":"image"}]';
  v_err boolean;
begin
  insert into produto_imagem_execucoes (modo, status) values ('aquisicao', 'executando') returning id into v_exec;
  insert into produto_imagem_candidatos (execucao_id, produto, cor_codigo, status, lacoste_pid, lacoste_color_id, lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json)
    values (v_exec, 'TEST-REF', 'T01', 'pendente', 'TEST-REF', 'T01', 'Test', 'Test', 'https://x', true, v_gal) returning id into v_ok;

  select * into v_before from produto_imagem_candidatos where id = v_ok;

  -- 1. valid update
  perform registrar_pontuacao_candidato(v_ok, v_u1, 'r1', v_u2, 'r2', '{"confidence":"high"}', array['lim']);
  select * into v_after from produto_imagem_candidatos where id = v_ok;
  assert v_after.primary_candidate_url = v_u1 and v_after.secondary_candidate_url = v_u2, 'urls not stored';
  assert v_after.limitacoes = array['lim'], 'limitacoes not stored';

  -- 2. identity/verification/review columns unchanged
  assert (v_before.produto, v_before.cor_codigo, v_before.status, v_before.lacoste_pid, v_before.lacoste_color_id,
          v_before.resolved_url, v_before.verification_ok, v_before.gallery_json, v_before.revisado_por, v_before.revisado_em, v_before.criado_em)
      is not distinct from
         (v_after.produto, v_after.cor_codigo, v_after.status, v_after.lacoste_pid, v_after.lacoste_color_id,
          v_after.resolved_url, v_after.verification_ok, v_after.gallery_json, v_after.revisado_por, v_after.revisado_em, v_after.criado_em),
      'protected columns changed';

  -- 3. rejections
  v_err := false; begin perform registrar_pontuacao_candidato(v_ok, 'https://imagesa1.lacoste.com/t/other.jpg', 'r', null, null, '{}', '{}'); exception when others then v_err := true; end;
  assert v_err, 'foreign url accepted';
  v_err := false; begin perform registrar_pontuacao_candidato(v_ok, v_u1, 'r', v_u1, 'r', '{}', '{}'); exception when others then v_err := true; end;
  assert v_err, 'identical primary/secondary accepted';
  v_err := false; begin perform registrar_pontuacao_candidato(v_ok, null, 'r', v_u2, 'r', '{}', '{}'); exception when others then v_err := true; end;
  assert v_err, 'secondary without primary accepted';
  v_err := false; begin perform registrar_pontuacao_candidato(gen_random_uuid(), v_u1, 'r', null, null, '{}', '{}'); exception when others then v_err := true; end;
  assert v_err, 'missing id accepted';

  -- 4. non-pending rejected (needs a reviewer; use any existing funcionario)
  select id into v_aprov from funcionarios limit 1;
  if v_aprov is not null then
    insert into produto_imagem_candidatos (execucao_id, produto, cor_codigo, status, lacoste_pid, lacoste_color_id, lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json, revisado_por, revisado_em)
      values (v_exec, 'TEST-REF2', 'T01', 'aprovado', 'TEST-REF2', 'T01', 'Test', 'Test', 'https://x', true, v_gal, v_aprov, now()) returning id into v_aprov;
    v_err := false; begin perform registrar_pontuacao_candidato(v_aprov, v_u1, 'r', null, null, '{}', '{}'); exception when others then v_err := true; end;
    assert v_err, 'non-pending accepted';
  end if;

  -- 5. least privilege
  assert has_function_privilege('service_role', 'public.registrar_pontuacao_candidato(uuid,text,text,text,text,jsonb,text[])', 'execute'), 'service_role lacks execute';
  assert not has_function_privilege('anon', 'public.registrar_pontuacao_candidato(uuid,text,text,text,text,jsonb,text[])', 'execute'), 'anon can execute';
  assert not has_function_privilege('authenticated', 'public.registrar_pontuacao_candidato(uuid,text,text,text,text,jsonb,text[])', 'execute'), 'authenticated can execute';
  assert not has_table_privilege('service_role', 'public.produto_imagem_candidatos', 'update'), 'service_role has table UPDATE';
end $$;

rollback;
