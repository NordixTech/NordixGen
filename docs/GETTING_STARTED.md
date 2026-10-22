# Quick start

Create a small notes application, then add the features you need.

## 1. Prepare your tools

Install Node.js 24+, pnpm 10.5.2 and Git. Set a Git author name and email; generation creates an initial commit. Network access is required to download scaffolders and dependencies.

In the NordixGen checkout:

```bash
pnpm install --frozen-lockfile
pnpm build
```

## 2. Create a configuration

```bash
node packages/cli/dist/index.js init
```

Choose a name and enable a frontend when prompted. The starter includes a database-backed example with public list/create operations. Keep its default filename, `nordix.config.yaml`, for the commands below.

To understand the configuration, this complete example defines a public notes application:

```yaml
schemaVersion: 2
name: notes-app
version: 1.0.0
repositories:
  - name: app
    path: .
databases:
  primary: {}
backends:
  - name: api
    repository: app
    path: apps/api
    persistence: { database: primary }
    modules:
      notes:
        architecture: clean
        entities: [Note]
frontends:
  - name: web
    repository: app
    path: apps/web
    connectsTo: [api]
entities:
  Note:
    backend: api
    fields:
      title: { type: string, minLength: 1, maxLength: 200 }
      content: { type: string, required: false }
endpoints:
  - backend: api
    entity: Note
    operationId: listNotes
    method: GET
    path: /api/notes
  - backend: api
    entity: Note
    operationId: createNote
    method: POST
    path: /api/notes
    requestBody:
      useCase: { entity: Note, operation: create }
```

The entity defines stored data. The endpoints define the API and the actions available to the frontend. Declaring an entity alone does not create CRUD routes.

## 3. Validate and generate

```bash
node packages/cli/dist/index.js validate -f nordix.config.yaml
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./my-project
```

The output directory must be new or empty. Generation installs dependencies, checks application types and backend boundaries, then initializes Git. It does not create cloud resources. If an external command fails, inspect its error and retry with an empty target after fixing the cause.

## 4. Run the application

In the generated repository root, with Docker Engine and Compose v2 installed:

```bash
cd my-project
docker compose up -d --build
```

Open `http://localhost:3000` for the example above. The Notes screen can list and create records. Docker supplies PostgreSQL and applies the generated migration history before the backend starts. Backend ports stay private by default.

```bash
docker compose down   # Stop while preserving database volumes
```

The generated `pnpm docker:down` shortcut also deletes local database volumes. Use it only when you intend to discard that data.

Prefer host development with source reload? Follow [Local development](guides/LOCAL_DEVELOPMENT.md).

## Next steps

Learn [project structure](configuration/PROJECT_STRUCTURE.md), add [entities](configuration/ENTITIES.md) and [endpoints](configuration/ENDPOINTS.md), or enable [authentication](guides/AUTHENTICATION.md).

Once generated, edit the application itself. NordixGen does not overwrite or synchronize an edited project; see [Continue development](EXTENDING_PROJECTS.md).
