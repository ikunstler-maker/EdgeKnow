-- Back to before voting and the timer: they go with their data.
drop function public.set_board_timer(uuid, integer);
drop function public.toggle_board_vote(uuid, text);
drop function public.set_board_voting(uuid, integer);
drop function public.board_session(uuid);
drop table public.board_votes;
drop table public.board_sessions;
drop function public.check_board_session_workspace();
