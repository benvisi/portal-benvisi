begin;

-- =============================================================================
-- Epic 2 Stabilization — Checklist Item 2 Guidance (Checklist V2)
--
-- Regression finding: "Arrumar e/ou devolver as peças do atendimento" (item
-- 2 of Checklist V1) has no guia_bullets, unlike items 1 and 3, making it
-- look sparse. Approved fix: add exactly two guidance bullets under it.
--
-- Why this cannot edit the existing V1 row: per the checklist-versioning
-- rule established since Milestone 2B (docs/portal-benvisi-blueprint.md,
-- "Imutabilidade das versões utilizadas") and enforced by this project's own
-- migration-immutability convention, a checklist version already used in
-- production — V1 has been live since 20260821_001 — must never have its
-- item content (title, guidance, meaning) altered retroactively. Guidance
-- bullets are exactly the kind of content that rule protects: they are what
-- the employee actually reads when performing the confirmation, so adding
-- them to V1 in place would silently change what a historical V1 completion
-- represents. This migration therefore introduces Checklist V2 instead —
-- the same "nova necessidade operacional -> criar Checklist V2" path this
-- project's own documentation already anticipated.
--
-- V2 is otherwise identical to V1: the same three items, same codigo,
-- titulo, ordem_exibicao, and obrigatorio = true for every item — only item
-- 2's guia_bullets differ. No new checklist confirmation is introduced; the
-- checklist remains exactly three primary confirmations, and the new
-- bullets are guidance only, never separate checkboxes (enforced by the
-- frontend, which has always rendered guia_bullets as plain bullets under
-- an item's title, never as their own toggles).
--
-- V1's three items are marked ativo = false so exactly one version is ever
-- "the" active one at a glance (list_atendimento_checklist_itens and every
-- concluir_* RPC already resolve the active version as
-- max(versao) where ativo = true, so this flip is not strictly required for
-- correctness — V2's higher version number would already win — but keeps
-- the data honest or a future direct ativo = true query). This only flips a
-- config/operational flag on the V1 rows; none of their content columns
-- (codigo, titulo, guia_bullets, ordem_exibicao, obrigatorio) are touched,
-- so no historical V1 completion's meaning is altered.
--
-- No RPC or frontend changes are needed: list_atendimento_checklist_itens,
-- concluir_atendimento, concluir_atendimento_pendente, and
-- concluir_checklist_avulso all already resolve the active version
-- generically, and ChecklistItemRow.tsx already renders guia_bullets
-- generically for whatever items it receives.
-- =============================================================================

insert into public.atendimento_checklist_itens
  (versao, codigo, titulo, guia_bullets, ordem_exibicao, obrigatorio)
values
  (
    2,
    'conferir_provador',
    'Conferir o provador',
    array[
      'Verificar se o cliente esqueceu ou perdeu algum item pessoal',
      'Recolher peças que precisam ser arrumadas e/ou devolvidas',
      'Retirar qualquer lixo',
      'Deixar a cortina aberta para o lado direito'
    ],
    1,
    true
  ),
  (
    2,
    'arrumar_devolver_pecas',
    'Arrumar e/ou devolver as peças do atendimento',
    array[
      'Dobrar ou colocar corretamente no cabide as peças do atendimento.',
      'Devolver as peças ao local correto ou encaminhá-las para reposição.'
    ],
    2,
    true
  ),
  (
    2,
    'verificar_loja',
    'Verificar a loja toda',
    array[
      'Organizar as peças e a exposição, incluindo pilhas',
      'Repor peças quando necessário',
      'Retirar qualquer lixo ou sujeira'
    ],
    3,
    true
  )
on conflict (versao, codigo) do nothing;

update public.atendimento_checklist_itens
set ativo = false
where versao = 1 and ativo = true;

commit;
