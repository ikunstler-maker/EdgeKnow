-- Undo 20270109100000_column_rules (rules for leaving and changing are removed; column limits are forgotten).
drop trigger tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of status_id, assignee_id, due_date on public.tasks
  for each row when (coalesce(current_setting('ek.importing', true), '') <> 'on') execute function public.notify_task_change();
create or replace function public.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.task_rules;
  cat text;
  actor uuid := auth.uid();
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    cat := (select s.category from public.task_statuses s where s.id = new.status_id);
    for rule in select * from public.task_rules r where r.project_id = new.project_id
                  and ((r.event = 'enter_status' and r.status_id = new.status_id) or (r.event = 'enter_category' and r.category = cat)) loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'assigned', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'assigned' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'due', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'due_changed' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  return new;
end;
$$;
delete from public.task_rules where event in ('leave_status', 'change_in_status');
alter table public.task_rules drop constraint task_rules_check1;
alter table public.task_rules add constraint task_rules_check1 check ((event = 'enter_status') = (status_id is not null));
alter table public.task_rules drop constraint task_rules_event_check;
alter table public.task_rules add constraint task_rules_event_check check (event in ('enter_category', 'enter_status', 'assigned', 'comment', 'due_changed'));
drop function public.column_moves(uuid);
drop trigger task_placements_gate on public.task_placements;
drop function public.placement_gate();
drop function public.column_allows(public.task_statuses, text, uuid);
drop function public.set_column_options(uuid, jsonb);
alter table public.task_statuses drop column put_groups, drop column take_groups, drop column color, drop column short_name;
