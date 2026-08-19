---
description: Inspect neko's local storage — SQLite tables + on-disk event stream
---

# inspect-db

Use when the user wants to see what neko has persisted locally — sessions,
projects, credentials (metadata only, not values), permissions, and event
files. Repo-specific: knows this project's storage layout.

## Where things live

- **SQLite DB**: `~/.local/share/neko/neko.db`
  - Tables: `sessions`, `projects`, `permissions`, `credentials`, `meta`, `schema_migrations`
  - Session row shape: `id`, `projectID`, `time_created`, `time_archived`,
    `eventSeq`, `lastCompactionSeq`, `data` (JSON blob = full `Session.Info`)
- **Event stream**: `~/.local/share/neko/events/{sessionID}/{seq}.json`
  - One JSON file per event, zero-padded 20-digit filename for lexicographic sort
  - `eventSeq` in the sessions table is advisory — filesystem is source of truth

## Standard checks

1. **What's in the DB overall**:
   ```bash
   sqlite3 -header ~/.local/share/neko/neko.db "
     SELECT 'sessions' AS t, COUNT(*) AS n FROM sessions
     UNION ALL SELECT 'projects', COUNT(*) FROM projects
     UNION ALL SELECT 'credentials', COUNT(*) FROM credentials
     UNION ALL SELECT 'permissions', COUNT(*) FROM permissions;
   "
   ```

2. **Recent sessions** with event counts:
   ```bash
   sqlite3 -header ~/.local/share/neko/neko.db "
     SELECT id, projectID, time_created, eventSeq FROM sessions
     ORDER BY time_created DESC LIMIT 10;
   "
   ```

3. **Event types for a session** (given `$SID`):
   ```bash
   for f in ~/.local/share/neko/events/$SID/*.json; do jq -r '.type' "$f"; done
   ```

4. **Credentials** — DO NOT print the `data` column (contains API keys).
   Only show `integrationID`, `label`, and timestamps:
   ```bash
   sqlite3 -header ~/.local/share/neko/neko.db "
     SELECT id, integrationID, label, time_created FROM credentials;
   "
   ```

5. **Applied migrations**:
   ```bash
   sqlite3 ~/.local/share/neko/neko.db "SELECT id, applied_at FROM schema_migrations;"
   ```

## Rules

- Never dump the `credentials.data` column — it holds plaintext API keys.
- For big event dumps, prefer counts + type histograms over full contents.
- If the user asks for a specific session's transcript, use
  `jq '.type + " " + (.data.text // .data.prompt.text // "")'` to project
  compactly instead of dumping raw JSON.
