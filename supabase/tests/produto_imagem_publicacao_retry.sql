-- Behaviour tests for 20261103_001_add_produto_imagem_publicacao_retry_limits.
-- Requires 20261030_001 to be applied first. NOT YET RUN against a database
-- (no local Postgres in the development environment); run it on a throwaway
-- or rollback-safe target before applying the migration to production.
-- Rollback-safe: everything runs inside one DO block that ends by raising
-- 'ALL_TESTS_PASSED_ROLLBACK'. Any failed assertion raises a different error.
-- Run as postgres. Uses only synthetic employees, sessions and candidates.
do $$
declare
  v_exec uuid;
  v_gestor uuid;
  v_tok text;
  v_c1 uuid;
  v_pub uuid;
  v_n integer;
  v_t integer;
  v_prox timestamptz;
  v_perm timestamptz;
  v_err text;
  v_gal jsonb := '[
    {"desktopUrl":"//imagesa1.lacoste.com/dw/image/v2/X/dwaaaa1111/TST_T01_24.jpg","type":"image"}
  ]';
  v_notes jsonb := '{"confidence":"high","human_reviewed":true,"images":[
    {"index":0,"has_person":false,"product_only_still":true}]}';
begin
  insert into public.funcionarios (nome, apelido, token_pin, cargo, pode_gerenciar_imagens_produto)
  values ('Teste Gestor Retry', 'tst-gestor-retry', 'x', 'Gerente', true) returning id into v_gestor;
  v_tok := public.issue_employee_session(v_gestor);
  insert into public.produto_imagem_execucoes (modo, status) values ('aquisicao', 'executando') returning id into v_exec;
  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json, scoring_notes)
  values (v_exec, 'TST-RTY', 'T01', 'TST-RTY', 'T01', 'Test', 'Test', 'https://x', true, v_gal, v_notes) returning id into v_c1;
  v_pub := public.aprovar_candidato_imagem(v_tok, v_c1, 0);

  -- 1. A fresh publication is listed with no retry bookkeeping.
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 1, '1a fresh publication listed';

  -- 2. First failure: attempt counted, error kept, backed off ~15 min, not listed.
  perform public.registrar_falha_publicacao_imagem(v_pub, 'falha 1');
  select tentativas, proxima_tentativa_em, falha_permanente_em into v_t, v_prox, v_perm
    from public.produto_imagem_publicacoes where id = v_pub;
  assert v_t = 1 and v_perm is null, '2a attempt counted, not permanent';
  assert v_prox between now() + interval '14 minutes' and now() + interval '16 minutes', '2b backoff ~15 min';
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 0, '2c not listed while backing off';

  -- 3. Backoff elapsed: listed again.
  update public.produto_imagem_publicacoes set proxima_tentativa_em = now() - interval '1 minute' where id = v_pub;
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 1, '3a listed once the backoff elapsed';

  -- 4. Backoff grows: failure 2 -> 60 min, failure 3 -> 240 min, failure 4 -> 360 min (cap).
  perform public.registrar_falha_publicacao_imagem(v_pub, 'falha 2');
  select proxima_tentativa_em into v_prox from public.produto_imagem_publicacoes where id = v_pub;
  assert v_prox between now() + interval '59 minutes' and now() + interval '61 minutes', '4a 60 min';
  perform public.registrar_falha_publicacao_imagem(v_pub, 'falha 3');
  select proxima_tentativa_em into v_prox from public.produto_imagem_publicacoes where id = v_pub;
  assert v_prox between now() + interval '239 minutes' and now() + interval '241 minutes', '4b 240 min';
  perform public.registrar_falha_publicacao_imagem(v_pub, 'falha 4');
  select proxima_tentativa_em into v_prox from public.produto_imagem_publicacoes where id = v_pub;
  assert v_prox between now() + interval '359 minutes' and now() + interval '361 minutes', '4c capped at 360 min';

  -- 5. Fifth failure is permanent: no more schedule, never listed, still pending + approved.
  perform public.registrar_falha_publicacao_imagem(v_pub, 'falha 5');
  select tentativas, proxima_tentativa_em, falha_permanente_em into v_t, v_prox, v_perm
    from public.produto_imagem_publicacoes where id = v_pub;
  assert v_t = 5 and v_prox is null and v_perm is not null, '5a permanent failure recorded';
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 0, '5b permanently failed publication is not listed';
  update public.produto_imagem_publicacoes set proxima_tentativa_em = null where id = v_pub;
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 0, '5c permanent flag alone excludes it';
  assert (select status from public.produto_imagem_publicacoes where id = v_pub) = 'pendente', '5d still pendente';
  assert (select status from public.produto_imagem_candidatos where id = v_c1) = 'aprovado', '5e approval intact';
  assert (select ultimo_erro from public.produto_imagem_publicacoes where id = v_pub) = 'falha 5', '5f error kept';

  -- 6. A late duplicate failure report does not change a permanent failure.
  perform public.registrar_falha_publicacao_imagem(v_pub, 'duplicado');
  assert (select tentativas from public.produto_imagem_publicacoes where id = v_pub) = 5, '6a no extra attempt';

  -- 7. Re-approval is still impossible while the publication is parked.
  begin perform public.aprovar_candidato_imagem(v_tok, v_c1, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'TRANSICAO_INVALIDA', '7a candidate cannot be approved twice: ' || v_err;

  -- 8. Requeue restores the budget and the queue entry; keeps the diagnostic error.
  perform public.reenfileirar_publicacao_imagem(v_pub);
  select tentativas, proxima_tentativa_em, falha_permanente_em into v_t, v_prox, v_perm
    from public.produto_imagem_publicacoes where id = v_pub;
  assert v_t = 0 and v_prox is null and v_perm is null, '8a counters reset';
  assert (select ultimo_erro from public.produto_imagem_publicacoes where id = v_pub) = 'falha 5', '8b last error kept';
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5) where publicacao_id = v_pub;
  assert v_n = 1, '8c listed again after requeue';

  begin perform public.reenfileirar_publicacao_imagem(gen_random_uuid()); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'PUBLICACAO_NAO_ENCONTRADA', '8d unknown publication: ' || v_err;

  -- 9. Privileges: requeue is worker-only.
  assert not has_function_privilege('anon', 'public.reenfileirar_publicacao_imagem(uuid)', 'execute'), '9a anon cannot requeue';
  assert not has_function_privilege('authenticated', 'public.reenfileirar_publicacao_imagem(uuid)', 'execute'), '9b authenticated cannot requeue';
  assert has_function_privilege('service_role', 'public.reenfileirar_publicacao_imagem(uuid)', 'execute'), '9c service_role can requeue';
  assert not has_function_privilege('anon', 'public.listar_publicacoes_imagem_pendentes(integer)', 'execute'), '9d worker queue still private';

  raise exception 'ALL_TESTS_PASSED_ROLLBACK';
end;
$$;
