-- Behaviour tests for 20261030_001_add_produto_imagem_aprovacao_publicacao.
-- Rollback-safe: everything runs inside one DO block that ends by raising
-- 'ALL_TESTS_PASSED_ROLLBACK', so no synthetic row ever persists. Any failed
-- assertion raises a different error (also rolling back). Run as postgres.
-- Uses only synthetic employees, sessions, candidates and publications.
do $$
declare
  v_exec uuid;
  v_gestor uuid;
  v_comum uuid;
  v_tok_gestor text;
  v_tok_comum text;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid;
  v_pub1 uuid; v_pub2 uuid; v_pub3 uuid;
  v_arq uuid;
  v_n integer;
  v_status text;
  v_err text;
  v_gal jsonb := '[
    {"desktopUrl":"//imagesa1.lacoste.com/dw/image/v2/X/dwaaaa1111/TST_T01_24.jpg","type":"image"},
    {"desktopUrl":"//imagesa1.lacoste.com/dw/image/v2/X/dwbbbb2222/TST_T01_20.jpg","type":"image"},
    {"desktopUrl":"//imagesa1.lacoste.com/dw/image/v2/X/dwcccc3333/TST_T01_31.jpg","type":"image"},
    {"desktopUrl":"//evil.example.com/x.jpg","type":"image"},
    {"desktopUrl":"//imagesa1.lacoste.com/dw/image/v2/X/dwdddd4444/TST_T01_L1.jpg","type":"look"}
  ]';
  v_notes jsonb := '{"confidence":"high","human_reviewed":true,"images":[
    {"index":0,"has_person":false,"product_only_still":true},
    {"index":1,"has_person":true,"product_only_still":false},
    {"index":2,"has_person":false,"product_only_still":true}]}';
  v_sha text := repeat('a', 64);
  v_sha2 text := repeat('b', 64);
begin
  -- Fixtures -----------------------------------------------------------------
  insert into public.funcionarios (nome, apelido, token_pin, cargo, pode_gerenciar_imagens_produto)
  values ('Teste Gestor Imagens', 'tst-gestor-img', 'x', 'Gerente', true) returning id into v_gestor;
  insert into public.funcionarios (nome, apelido, token_pin, cargo)
  values ('Teste Sem Permissao', 'tst-comum-img', 'x', 'Administrador') returning id into v_comum;
  v_tok_gestor := public.issue_employee_session(v_gestor);
  v_tok_comum := public.issue_employee_session(v_comum);

  insert into public.produto_imagem_execucoes (modo, status) values ('aquisicao', 'executando') returning id into v_exec;

  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json, scoring_notes)
  values (v_exec, 'TST-001', 'T01', 'TST-001', 'T01', 'Test', 'Test', 'https://x', true, v_gal, v_notes) returning id into v_c1;
  -- identity mismatch (silent colour fallback recorded) — must never be approvable
  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json)
  values (v_exec, 'TST-002', 'T01', 'TST-002', 'ZZZ', 'Test', 'Test', 'https://x', true, v_gal) returning id into v_c2;

  -- 1. Authorization ----------------------------------------------------------
  begin perform public.aprovar_candidato_imagem(null, v_c1, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_SESSION', '1a no session: ' || v_err;

  begin perform public.aprovar_candidato_imagem('not-a-token', v_c1, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_SESSION', '1b bad token: ' || v_err;

  -- Administrador cargo and scoring_notes.human_reviewed=true grant nothing.
  begin perform public.aprovar_candidato_imagem(v_tok_comum, v_c1, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'SEM_PERMISSAO_IMAGENS_PRODUTO', '1c no capability: ' || v_err;

  begin perform public.rejeitar_candidato_imagem(v_tok_comum, v_c1, 'x'); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'SEM_PERMISSAO_IMAGENS_PRODUTO', '1d reject no capability: ' || v_err;

  begin perform * from public.get_candidatos_imagem_pendentes(v_tok_comum); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'SEM_PERMISSAO_IMAGENS_PRODUTO', '1e queue no capability: ' || v_err;

  assert public.get_produto_imagens_permissao(v_tok_gestor) and not public.get_produto_imagens_permissao(v_tok_comum), '1f permission flag';

  -- Revoked session is refused.
  update public.sessoes_funcionario set revogado_em = now() where id_funcionario = v_comum;
  begin perform public.get_produto_imagens_permissao(v_tok_comum); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INVALID_SESSION', '1g revoked session: ' || v_err;

  -- 2. Validation -------------------------------------------------------------
  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 9); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INDICE_INVALIDO', '2a out of range: ' || v_err;

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, -1); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INDICE_INVALIDO', '2b negative: ' || v_err;

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 0, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'INDICE_INVALIDO', '2c same index: ' || v_err;

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 3); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'URL_NAO_PERMITIDA', '2d foreign host: ' || v_err;

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 4); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'IMAGEM_NAO_ELEGIVEL', '2e look entry: ' || v_err;

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c2, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'IDENTIDADE_NAO_VERIFICADA', '2f identity mismatch: ' || v_err;

  -- AI flagged index 1 (person): needs explicit confirmation AND a note.
  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 1); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'DIVERGENCIA_IA_NAO_CONFIRMADA', '2g ai flag: ' || v_err;
  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 1, null, null, true); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'DIVERGENCIA_IA_NAO_CONFIRMADA', '2h ai flag without note: ' || v_err;

  begin perform public.rejeitar_candidato_imagem(v_tok_gestor, v_c1, '   '); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'OBSERVACAO_OBRIGATORIA', '2i reject needs note: ' || v_err;

  -- Nothing above changed the candidate.
  select status into v_status from public.produto_imagem_candidatos where id = v_c1;
  assert v_status = 'pendente', '2j still pending';
  assert (select count(*) from public.produto_imagem_publicacoes) = 0, '2k no publications yet';

  -- 3. Approval (human override: AI recommendation is irrelevant) -------------
  v_pub1 := public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 2, 0, '  ok  ');
  assert (select status = 'aprovado' and revisado_por = v_gestor and revisado_em is not null
            and final_primary_url = 'https://imagesa1.lacoste.com/dw/image/v2/X/dwcccc3333/TST_T01_31.jpg'
            and final_secondary_url = 'https://imagesa1.lacoste.com/dw/image/v2/X/dwaaaa1111/TST_T01_24.jpg'
            and revisao_observacao = 'ok'
            and lacoste_pid = 'TST-001' and gallery_json = v_gal
          from public.produto_imagem_candidatos where id = v_c1), '3a approval recorded';
  assert (select status = 'pendente' and candidato_id = v_c1 from public.produto_imagem_publicacoes where id = v_pub1), '3b pub pending';
  assert (select count(*) from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1) = 2, '3c two files';
  assert (select storage_path = 'TST-001/T01/' || v_pub1 || '/principal.webp'
          from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1 and slot = 'principal'), '3d immutable path';

  begin perform public.aprovar_candidato_imagem(v_tok_gestor, v_c1, 0); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'TRANSICAO_INVALIDA', '3e double approval: ' || v_err;
  begin perform public.rejeitar_candidato_imagem(v_tok_gestor, v_c1, 'x'); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'TRANSICAO_INVALIDA', '3f reject after approval: ' || v_err;

  -- Pending publications are invisible to Consulta.
  select count(*) into v_n from public.get_produto_imagens_publicadas(v_tok_gestor, 'tst-001');
  assert v_n = 0, '3g pending not visible';

  -- 4. Rejection ---------------------------------------------------------------
  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json)
  values (v_exec, 'TST-003', 'T01', 'TST-003', 'T01', 'Test', 'Test', 'https://x', true, v_gal) returning id into v_c3;
  perform public.rejeitar_candidato_imagem(v_tok_gestor, v_c3, 'fotos ruins');
  assert (select status = 'rejeitado' and revisado_por = v_gestor and final_primary_url is null
          from public.produto_imagem_candidatos where id = v_c3), '4a rejected';
  assert not exists (select 1 from public.produto_imagem_publicacoes where candidato_id = v_c3), '4b no publication';

  -- 5. Publishing worker RPCs ------------------------------------------------
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5);
  assert v_n = 1, '5a one pending publication listed';

  begin perform public.ativar_publicacao_imagem(v_pub1); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'ARQUIVOS_INCOMPLETOS', '5b cannot activate before upload: ' || v_err;

  select id into v_arq from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1 and slot = 'principal';
  perform public.registrar_envio_arquivo_publicacao(v_arq, v_sha, v_sha2, 1000, 1200, 1200);
  perform public.registrar_envio_arquivo_publicacao(v_arq, v_sha, v_sha2, 1000, 1200, 1200); -- idempotent retry
  begin perform public.registrar_envio_arquivo_publicacao(v_arq, v_sha, v_sha, 1000, 1200, 1200); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'ARQUIVO_DIVERGENTE', '5c divergent re-record refused: ' || v_err;

  begin perform public.registrar_envio_arquivo_publicacao(
    (select id from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1 and slot = 'secundaria'),
    'not-a-sha', v_sha2, 1000, 1200, 1200); v_err := 'none';
  exception when others then v_err := sqlstate; end;
  assert v_err = '23514', '5d bad sha rejected by check: ' || v_err;
  begin perform public.registrar_envio_arquivo_publicacao(
    (select id from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1 and slot = 'secundaria'),
    v_sha, v_sha2, 1000, 4000, 1200); v_err := 'none';
  exception when others then v_err := sqlstate; end;
  assert v_err = '23514', '5e oversize dimension rejected: ' || v_err;

  -- Partial failure: only primary recorded; failure is logged, still pending.
  perform public.registrar_falha_publicacao_imagem(v_pub1, 'upload secundaria falhou');
  assert (select status = 'pendente' and tentativas = 1 and ultimo_erro like 'upload%'
          from public.produto_imagem_publicacoes where id = v_pub1), '5f failure recorded';
  begin perform public.ativar_publicacao_imagem(v_pub1); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'ARQUIVOS_INCOMPLETOS', '5g still incomplete: ' || v_err;

  perform public.registrar_envio_arquivo_publicacao(
    (select id from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub1 and slot = 'secundaria'),
    v_sha, v_sha2, 900, 800, 1200);
  perform public.ativar_publicacao_imagem(v_pub1);
  perform public.ativar_publicacao_imagem(v_pub1); -- idempotent
  assert (select status = 'ativa' and publicado_em is not null and ultimo_erro is null
          from public.produto_imagem_publicacoes where id = v_pub1), '5h active';
  select count(*) into v_n from public.get_produto_imagens_publicadas(v_tok_gestor, ' tst-001 ');
  assert v_n = 2, '5i consulta sees 2 active files';
  select count(*) into v_n from public.listar_publicacoes_imagem_pendentes(5);
  assert v_n = 0, '5j nothing pending';

  begin perform public.registrar_envio_arquivo_publicacao(v_arq, v_sha, v_sha2, 1000, 1200, 1200); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'PUBLICACAO_NAO_PENDENTE', '5k no writes to active pub: ' || v_err;

  -- 6. Replacement & concurrency invariants ------------------------------------
  -- Two newer candidates for the same product/colour.
  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json)
  values (v_exec, 'TST-001', 'T01', 'TST-001', 'T01', 'Test', 'Test', 'https://x', true, v_gal) returning id into v_c4;
  v_pub2 := public.aprovar_candidato_imagem(v_tok_gestor, v_c4, 0);
  insert into public.produto_imagem_candidatos (execucao_id, produto, cor_codigo, lacoste_pid, lacoste_color_id,
    lacoste_color_label, lacoste_product_name, resolved_url, verification_ok, gallery_json)
  values (v_exec, 'TST-001', 'T01', 'TST-001', 'T01', 'Test', 'Test', 'https://x', true, v_gal) returning id into v_c5;
  v_pub3 := public.aprovar_candidato_imagem(v_tok_gestor, v_c5, 2);

  -- Newer approval cancelled the older never-activated publication.
  assert (select status = 'cancelada' and encerrado_em is not null from public.produto_imagem_publicacoes where id = v_pub2), '6a pub2 cancelled';
  begin perform public.ativar_publicacao_imagem(v_pub2); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'PUBLICACAO_NAO_PENDENTE', '6b cancelled cannot activate: ' || v_err;

  -- Old active set stays visible until the new one is fully activated.
  select count(*) into v_n from public.get_produto_imagens_publicadas(v_tok_gestor, 'TST-001');
  assert v_n = 2, '6c old set still visible';

  perform public.registrar_envio_arquivo_publicacao(
    (select id from public.produto_imagem_publicacao_arquivos where publicacao_id = v_pub3 and slot = 'principal'),
    v_sha, v_sha, 500, 1200, 1000);
  perform public.ativar_publicacao_imagem(v_pub3);
  assert (select status = 'substituida' and substituida_por = v_pub3 and encerrado_em is not null
          from public.produto_imagem_publicacoes where id = v_pub1), '6d old set superseded';
  select count(*) into v_n from public.get_produto_imagens_publicadas(v_tok_gestor, 'TST-001');
  assert v_n = 1, '6e only new single-image set visible (old secondary gone too)';
  assert (select count(*) from public.produto_imagem_publicacoes where produto = 'TST-001' and status = 'ativa') = 1, '6f single active';

  -- Index guarantees a second active set is impossible even outside the RPCs.
  begin
    update public.produto_imagem_publicacoes set status = 'ativa', encerrado_em = null, substituida_por = null where id = v_pub1;
    v_err := 'none';
  exception when unique_violation then v_err := 'unique';
  end;
  assert v_err = 'unique', '6g partial unique index enforced: ' || v_err;

  -- 7. Revocation ----------------------------------------------------------------
  begin perform public.revogar_publicacao_imagem(v_tok_gestor, v_pub3, ''); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'MOTIVO_OBRIGATORIO', '7a needs reason: ' || v_err;
  begin perform public.revogar_publicacao_imagem(v_tok_gestor, v_pub1, 'x'); v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  assert v_err = 'TRANSICAO_INVALIDA', '7b cannot revoke superseded: ' || v_err;

  perform public.revogar_publicacao_imagem(v_tok_gestor, v_pub3, 'imagem incorreta');
  assert (select status = 'revogada' and revogado_por = v_gestor from public.produto_imagem_publicacoes where id = v_pub3), '7c revoked';
  select count(*) into v_n from public.get_produto_imagens_publicadas(v_tok_gestor, 'TST-001');
  assert v_n = 0, '7d nothing visible after revoke';
  -- History is preserved.
  assert (select count(*) from public.produto_imagem_publicacoes where produto = 'TST-001') = 3, '7e history kept';

  -- 8. Least privilege ------------------------------------------------------------
  assert has_function_privilege('anon', 'public.aprovar_candidato_imagem(text,uuid,integer,integer,text,boolean)', 'execute'), '8a anon approve rpc';
  assert has_function_privilege('anon', 'public.get_produto_imagens_publicadas(text,text)', 'execute'), '8b anon read rpc';
  assert not has_function_privilege('anon', 'public.ativar_publicacao_imagem(uuid)', 'execute'), '8c anon cannot activate';
  assert not has_function_privilege('anon', 'public.registrar_envio_arquivo_publicacao(uuid,text,text,integer,integer,integer)', 'execute'), '8d anon cannot record files';
  assert not has_function_privilege('anon', 'public.listar_publicacoes_imagem_pendentes(integer)', 'execute'), '8e anon cannot list worker queue';
  assert not has_function_privilege('authenticated', 'public.aprovar_candidato_imagem(text,uuid,integer,integer,text,boolean)', 'execute'), '8f authenticated not granted';
  assert not has_function_privilege('anon', 'public.produto_imagens_exigir_gestor(text)', 'execute'), '8g helper private';
  assert not has_function_privilege('service_role', 'public.produto_imagens_exigir_gestor(text)', 'execute'), '8h helper private (service_role)';
  assert has_function_privilege('service_role', 'public.ativar_publicacao_imagem(uuid)', 'execute'), '8i worker activate';
  assert not has_function_privilege('service_role', 'public.aprovar_candidato_imagem(text,uuid,integer,integer,text,boolean)', 'execute'), '8j worker cannot approve';
  assert not has_table_privilege('anon', 'public.produto_imagem_publicacoes', 'select'), '8k no anon table read';
  assert not has_table_privilege('service_role', 'public.produto_imagem_publicacoes', 'select'), '8l no service_role table read';
  assert not has_table_privilege('service_role', 'public.produto_imagem_candidatos', 'update'), '8m still no candidate UPDATE';

  raise exception 'ALL_TESTS_PASSED_ROLLBACK';
end $$;
