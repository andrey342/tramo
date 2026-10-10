---
name: sql-explain
description: Explain a query against the compose Postgres - plan, real timings and buffers, hypothetical indexes and the index advisor - and propose a migration when an index pays off. Use for a slow endpoint, a new repository query or a list that will grow (cursor pagination, dashboards).
argument-hint: '<sql> | <file with the query>'
allowed-tools: mcp__postgres__explain_query, mcp__postgres__analyze_query_indexes, mcp__postgres__analyze_workload_indexes, mcp__postgres__get_top_queries, mcp__postgres__analyze_db_health, mcp__postgres__get_object_details, mcp__postgres__execute_sql, Bash(docker compose exec postgres psql -U tramo_ro*), Bash(docker compose exec postgres psql -U tramo -d tramo -c ANALYZE*), Read, Grep
---

# Explain a query

Arguments: `$ARGUMENTS`. The `postgres` MCP server (`.mcp.json`) connects as `tramo_ro`:
read-only transactions, 30 s statement timeout. With TypeORM queries, take the SQL from
`DATABASE_LOG_QUERIES=true` logs or the repository code, with parameters filled in.

1. Statistics first: the advisor refuses stale ones. On the dev database run
   `docker compose exec postgres psql -U tramo -d tramo -c ANALYZE`.
2. Plan: `explain_query` with the SQL (restricted mode refuses `analyze: true`). For real timings
   and buffers, run it as the read-only role:
   `docker compose exec postgres psql -U tramo_ro -d tramo -c "EXPLAIN (ANALYZE, BUFFERS) <sql>"`.
   Only for SELECTs; never for statements with side effects.
3. Read the plan: sequential scans on tables that will grow, sorts that spill, row estimates far
   from actual rows, nested loops over large inputs. The dev database is small, so the planner
   picks sequential scans that say nothing about production. To see the real plan, generate
   volume inside a transaction that is rolled back, as the owner role, in one psql script:
   `BEGIN; INSERT ... SELECT ... FROM generate_series(1, 50000); ANALYZE <tables>;
EXPLAIN (ANALYZE, BUFFERS) <sql>; ROLLBACK;` piped to
   `docker compose exec -T postgres psql -U tramo -d tramo -f -`. Nothing is kept.
4. Candidates: `explain_query` with `hypothetical_indexes` (`[{ "table": "audit_log", "columns":
["resource_type", "occurred_at"] }]`, table name without schema) compares plans without
   creating anything; `analyze_query_indexes` with up to ten queries asks the advisor.
   `get_top_queries` (`sort_by: "total_time"` or `"mean_time"`) and `analyze_workload_indexes`
   look at what the running app actually does.
5. Propose: if an index wins clearly, write it with `/migration <module> add-<table>-<cols>-index`
   (`ix_<schema>_<table>_<cols>`, column order matching the filter and the sort, `CONCURRENTLY`
   for large tables). Otherwise say why the current plan is fine. Report the before/after plans.
