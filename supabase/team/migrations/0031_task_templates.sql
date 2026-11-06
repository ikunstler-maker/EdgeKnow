-- Task templates in a team's own database (as supabase/migrations/20261215100000_task_templates.sql).
-- Rollback: supabase/team/rollbacks/0031_task_templates.down.sql
-- Task templates (package 3): ready values for a new task. A project template
-- (owner_id null) is managed by the project's owners and offered to everyone who
-- creates tasks there; a personal one (owner_id = its author) is seen only by them.
-- Each side may have one default, and a person's own default wins.

create table public.task_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  owner_id      uuid references public.profiles (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  -- {title, type, priority, assignee_id, labels, estimate, custom, description}: as create_task takes them.
  data          jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  is_default    boolean not null default false,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index task_templates_project_idx on public.task_templates (project_id, owner_id);
create unique index task_templates_one_default on public.task_templates
  (project_id, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_default;
create trigger task_templates_same_workspace before insert or update on public.task_templates
  for each row execute function public.check_task_workspace();

alter table public.task_templates enable row level security;
revoke all on public.task_templates from public, anon, authenticated;
grant select on public.task_templates to authenticated;
create policy "Members see project templates and their own"
  on public.task_templates for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and (owner_id is null or owner_id = auth.uid()));

-- Creates (target null) or changes a template. personal: one's own, else the project's.
create function public.save_task_template(target_project uuid, target uuid, personal boolean, new_name text, new_data jsonb, make_default boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  role text := public.task_project_role(target_project);
  existing public.task_templates;
  me uuid := auth.uid();
  owner uuid := case when personal then auth.uid() end;
  problem text;
  saved uuid;
begin
  if me is null or ws is null or not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- The project's templates: its owners. Personal ones: whoever may create tasks there.
  if (personal and public.role_rank(role) < public.role_rank('editor')) or (not personal and coalesce(role, '') <> 'owner') then
    return public.page_error('forbidden');
  end if;
  if target is not null then
    select * into existing from public.task_templates x where x.id = target and x.project_id = target_project;
    if not found or existing.owner_id is distinct from owner then
      return public.page_error('forbidden');
    end if;
  elsif (select count(*) from public.task_templates x where x.project_id = target_project and x.owner_id is not distinct from owner) >= 50 then
    return public.page_error('too_many');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 or new_data is null or jsonb_typeof(new_data) <> 'object'
     or exists (select 1 from jsonb_object_keys(new_data) k where k not in ('title', 'type', 'priority', 'assignee_id', 'labels', 'estimate', 'custom', 'description'))
     or (new_data ? 'title' and (jsonb_typeof(new_data -> 'title') <> 'string' or char_length(new_data ->> 'title') > 100))
     or (new_data ? 'estimate' and jsonb_typeof(new_data -> 'estimate') not in ('number', 'null')) then
    return public.page_error('invalid');
  end if;
  begin
    problem := coalesce(public.task_fields_valid(target_project, new_data - 'title'), public.task_custom_valid(target_project, new_data -> 'custom'));
  exception when others then
    problem := 'invalid';
  end;
  if problem is not null then
    return public.page_error(problem);
  end if;
  if make_default then
    update public.task_templates x set is_default = false
    where x.project_id = target_project and x.owner_id is not distinct from owner and x.is_default and x.id is distinct from target;
  end if;
  if target is null then
    insert into public.task_templates (workspace_id, project_id, owner_id, name, data, is_default, created_by)
    values (ws, target_project, owner, btrim(new_name), new_data, coalesce(make_default, false), me)
    returning id into saved;
  else
    update public.task_templates x
    set name = btrim(new_name), data = new_data, is_default = coalesce(make_default, false), updated_at = now()
    where x.id = target
    returning id into saved;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

create function public.delete_task_template(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.task_templates;
begin
  select * into existing from public.task_templates x where x.id = target;
  if not found or not public.is_workspace_member(existing.workspace_id)
     or (existing.owner_id is null and coalesce(public.task_project_role(existing.project_id), '') <> 'owner')
     or (existing.owner_id is not null and existing.owner_id is distinct from auth.uid()) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_templates where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.save_task_template(uuid, uuid, boolean, text, jsonb, boolean), public.delete_task_template(uuid) from public, anon, authenticated;
grant execute on function public.save_task_template(uuid, uuid, boolean, text, jsonb, boolean), public.delete_task_template(uuid) to authenticated;
