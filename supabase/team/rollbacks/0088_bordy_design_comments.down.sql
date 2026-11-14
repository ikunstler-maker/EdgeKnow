-- Undo 0088_bordy_design_comments.
drop function public.delete_design_comment(uuid);
drop function public.resolve_design_comment(uuid, boolean);
drop function public.add_design_comment(uuid, text, double precision, double precision, text, text, uuid);
drop table public.design_comments;
