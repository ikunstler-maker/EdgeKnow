# Rollbacks

Each file undoes one migration from `supabase/migrations`. They are **not** applied
automatically. To roll back, run them newest first in Supabase → SQL Editor, then
delete the matching row from `supabase_migrations.schema_migrations`:

```sql
delete from supabase_migrations.schema_migrations where version = '20261028120000';
```

Data created after a migration (e.g. new workspaces) is lost when it is rolled back;
data that existed before is preserved.
