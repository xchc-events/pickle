# Running Pickle locally

Which terminal, which container, and in what order. Written because almost every
local problem here comes from doing something in one place when it belonged in
the other.

There is a formatted copy of this at
<https://claude.ai/code/artifact/d76bf18c-8ff9-4cf3-bcee-19cfb1aa7c07>. **This
file is canonical** — if the two disagree, this one wins.

---

## The mental model: two machines

The app and the database do not live in the same place. They talk over
`localhost:5432`, and that is the only connection between them.

|           | The app                               | The database                                                                     |
| --------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| **Where** | your Mac, as a `node` process         | Docker, container `pickleevents_devcontainer-db-1`                               |
| **What**  | `next dev` on port 3000               | `postgres:17-alpine` on port 5432                                                |
| **Start** | `npm run dev`                         | Docker Desktop, or `docker compose -f .devcontainer/docker-compose.yml up -d db` |
| **Stop**  | Ctrl+C                                | almost never — leave it running                                                  |
| **Holds** | your code, and a cached Prisma client | every event, person and hour you have seeded                                     |

**So: use the Mac terminal — or the VS Code terminal, which is the same thing.**
VS Code's built-in terminal is a Mac shell in a panel; use it if you like,
because it opens already in the project folder.

**You almost never touch Docker Desktop.** Open it to confirm the database is
running. Restarting the app never requires restarting the database.

### The caveat that changes everything

All of the above assumes you opened the project _normally_ in VS Code. If you
click **"Reopen in Container"**, the VS Code terminal stops being a Mac shell and
becomes a shell inside the devcontainer — different filesystem, different
`node_modules`, and the database moves to `db:5432`.

You are not currently using the devcontainer: `pickleevents_devcontainer-app-1`
has been stopped for a day. Everything here assumes you stay out of it.

---

## Routine A — looking at the app

1. **Check the database is up.** Docker Desktop should show
   `pickleevents_devcontainer-db-1` running. Or:

   ```bash
   docker ps --filter name=db --format "{{.Names}}  {{.Status}}"
   ```

   If nothing comes back, start it — this does not require the devcontainer:

   ```bash
   docker compose -f .devcontainer/docker-compose.yml up -d db
   ```

2. **Start the app**, in a terminal you can leave open:

   ```bash
   npm run dev
   ```

   Wait for `Ready in …`, then open <http://localhost:3000>.

3. **Sign in as whoever you need to be.** No password locally —
   <http://localhost:3000/sign-in> lists every seeded account, and clicking one
   makes you them. Switching roles is the only real way to test a permissions
   change.

4. **Stop it with Ctrl+C** when you're done. The database keeps running, which
   is what you want.

---

## Routine B — after a chunk of work is finished

In this order. Seeing it work comes before approving it: tests passing is not
the same as the page rendering.

1. **Restart the dev server. First, every time.**

   A running server caches the generated Prisma client, so after any schema
   change it keeps using the old one and every page 500s.

   ```bash
   # in the terminal running it
   # Ctrl+C, then:
   npm run dev
   ```

   If you can't find the window it's running in:

   ```bash
   lsof -ti:3000 | xargs kill
   npm run dev
   ```

2. **Apply any new migrations.** This applies what is on disk without
   prompting, and never destroys data:

   ```bash
   npm run db:deploy
   npm run db:generate
   ```

   Then restart the dev server again — new client, same cache problem.

3. **Click through it yourself.** For anything touching money, hours or
   permissions, sign in as each affected role. That is what the PR template's
   "Checked signed in as each role" box asks, and it is the box Claude cannot
   tick for you.

4. **Run the checks:**

   ```bash
   npm run check
   ```

5. **Review and merge on GitHub**, then bring your local copy back in line:

   ```bash
   git checkout main
   git pull
   npm run db:deploy   # if the merge carried a migration
   ```

6. **Say it's merged**, so the next branch starts from the right place.
   Branches stack when they share a migration.

---

## When something looks broken

| What you see                                    | What it is                                   | Fix                                     | Where  |
| ----------------------------------------------- | -------------------------------------------- | --------------------------------------- | ------ |
| Every page 500s after new work                  | Server holding a pre-migration Prisma client | Ctrl+C, `npm run dev`                   | Mac    |
| `Another next dev server is already running`    | An old server still holds port 3000          | `lsof -ti:3000 \| xargs kill`           | Mac    |
| `Can't reach database server at localhost:5432` | Postgres container is stopped                | Start it in Docker Desktop              | Docker |
| `Unknown field … for select statement`          | Same cached-client problem                   | `npm run db:generate`, restart          | Mac    |
| `.env.example: Operation not permitted`         | Claude's sandbox refusing to read env files  | Ignore — never happens in your terminal | Mac    |

---

## Don't

- **Don't stop the database container to fix an app problem.** They are
  unrelated. A broken page is on your Mac.
- **Don't run `npm run db:reset` casually.** It drops every table and re-seeds.
  No undo.
- **Don't delete the `postgres` Docker volume.** Removing the container is
  recoverable; the volume is where the data actually lives.
- **Don't `npm install` inside the devcontainer and then work on the Mac.**
  Native dependencies differ; the compose file keeps `node_modules` separate for
  exactly this reason.
- **Don't force-push a branch with an open PR.** Ask for a proper rebase
  instead.

---

## Housekeeping: the spare database container

Docker is running _two_ Postgres containers from this project:

| Container                        | Compose project             | Port            |                |
| -------------------------------- | --------------------------- | --------------- | -------------- |
| `pickleevents_devcontainer-db-1` | `pickleevents_devcontainer` | 5432, published | the real one   |
| `devcontainer-db-1`              | `devcontainer`              | not published   | leftover, idle |

The second is a stray from an earlier devcontainer build under a different
project name. It has its own volume, holds nothing needed, and cannot take port
5432 because it publishes none — harmless, but misleading in Docker Desktop.
To remove it:

```bash
docker rm devcontainer-db-1
docker volume rm devcontainer_postgres
```

**Read the name before pressing enter.** Remove `devcontainer-db-1`; keep
`pickleevents_devcontainer-db-1`. They differ by a prefix, and removing the
wrong volume destroys the seeded data.
