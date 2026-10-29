-- Run only on Supabase; the migration runner skips this file on plain Postgres.
-- No browser write privileges: API verifies JWT, membership and input then writes.
CREATE OR REPLACE FUNCTION public.has_project(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.project_memberships WHERE project_id=p AND user_id=auth.uid())
$$;
REVOKE ALL ON FUNCTION public.has_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_project(uuid) TO authenticated;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_read ON projects FOR SELECT TO authenticated USING(public.has_project(id));
ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON project_memberships FOR SELECT TO authenticated USING(user_id=auth.uid());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['collections','source_documents','source_versions','chunks','research_runs','research_tasks','evidence','claims','citations','run_events','usage_records','contexts','effects','evaluation_runs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  -- Internal prompts and cached model outputs stay behind the authenticated API.
  IF t NOT IN ('effects','contexts') THEN
   EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT TO authenticated USING(public.has_project(project_id))',t);
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END IF;
 END LOOP;
END $$;
GRANT SELECT ON public.projects, public.project_memberships TO authenticated;
ALTER TABLE embedding_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
-- Private bucket; all downloads flow through the membership-checked API.
INSERT INTO storage.buckets(id,name,public) VALUES('research-sources','research-sources',false) ON CONFLICT(id) DO NOTHING;
