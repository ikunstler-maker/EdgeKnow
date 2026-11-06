-- Undo 20261211100000_notifications.sql.

drop trigger page_mentions_notify on public.page_mentions;
drop trigger task_comments_notify on public.task_comments;
drop trigger tasks_notify on public.tasks;
drop function public.delete_task_rule(uuid);
drop function public.save_task_rule(uuid, jsonb);
drop function public.set_notification_prefs(uuid, text[]);
drop function public.mark_notifications_read(uuid, uuid[]);
drop function public.my_notifications(uuid, integer);
drop function public.notify_page_mention();
drop function public.notify_task_comment();
drop function public.notify_task_change();
drop function public.notify_rule(public.task_rules, public.tasks, text, uuid);
drop function public.notify_person(uuid, uuid, text, uuid, uuid, uuid, uuid);
drop trigger task_rules_same_workspace on public.task_rules;
drop function public.check_task_rule_workspace();
drop table public.task_rules;
drop table public.notification_prefs;
drop table public.notifications;
-- Columns of the new type become "in progress" again.
update public.task_statuses set category = 'doing' where category = 'review';
alter table public.task_statuses drop constraint task_statuses_category_check;
alter table public.task_statuses add constraint task_statuses_category_check check (category in ('todo', 'doing', 'done'));

create or replace function public.save_task_status(target_project uuid, target_status uuid, new_name text, new_category text, new_wip_limit integer, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 40 then
    return public.page_error('invalid_name');
  end if;
  if new_category not in ('todo', 'doing', 'done') or (new_wip_limit is not null and new_wip_limit not between 1 and 999) then
    return public.page_error('invalid');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if target_status is null then
    if (select count(*) from public.task_statuses s where s.project_id = target_project) >= 20 then
      return public.page_error('too_many_columns');
    end if;
    insert into public.task_statuses (project_id, workspace_id, name, category, wip_limit, position)
    values (target_project, ws, btrim(new_name), new_category, new_wip_limit,
            coalesce(new_position, (select max(s.position) from public.task_statuses s where s.project_id = target_project) + 1, 1))
    returning id into saved;
  else
    update public.task_statuses
    set name = btrim(new_name), category = new_category, wip_limit = new_wip_limit, position = coalesce(new_position, position)
    where id = target_status and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;
