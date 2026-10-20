do $$
declare v_definition text; v_from text := '(dc.has_cycle or not coalesce(dep.base_allowed,false))';
v_to text := '(dc.has_cycle or (dc.required_id is not null and not coalesce(dep.base_allowed,false)))';
begin
select pg_get_functiondef('pts_private.pts_my_permission_details()'::regprocedure) into v_definition;
if (length(v_definition)-length(replace(v_definition,v_from,'')))/length(v_from) <> 2 then
raise exception 'unexpected function body'; end if;
execute replace(v_definition,v_from,v_to);
end $$;;
