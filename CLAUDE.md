# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run smart-reinstall`: Install deps (if lockfile changed) + build via Turborepo
- `npm run reinstall`: Clean install — wipe `node_modules` and reinstall from scratch
- `npm run backend:dev`: Start backend with file watching (port 3080)
- `npm run frontend:dev`: Start frontend dev server with HMR (port 3090, requires backend running)
- `npm run build`: Build all compiled code via Turborepo
- `npm run build:data-provider`: Rebuild `packages/data-provider` after changes

### Testing
- Run tests from their workspace directory:
  - `cd api && npx jest <pattern>`
  - `cd packages/api && npx jest <pattern>`
- Frontend: `__tests__` directories alongside components; use `test/layout-test-utils`.
- Backend: `mongodb-memory-server` for real DB tests.

## Architecture

LibreChat is a monorepo with the following structure:

| Workspace | Language | Purpose |
|---|---|---|
| `/api` | JS (legacy) | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | New backend code lives here |
| `/packages/data-schemas` | TypeScript | Database models/schemas |
| `/packages/data-provider` | TypeScript | Shared API types, endpoints, and data-service |
| `/client` | TypeScript/React | Frontend SPA |
| `/packages/client` | TypeScript | Shared frontend utilities |

### Boundaries
- All new backend code must be TypeScript in `/packages/api`.
- Keep `/api` changes to absolute minimum (thin JS wrappers).
- Frontend/backend shared API logic must go in `/packages/data-provider`.

## Code Style

- **Naming**: Single-word file names; group related modules under single-word directories.
- **NEVER use `any`**. Use explicit types for all parameters, return values, and variables.
- **Minimize looping**: Prefer single-pass transformations.
- **No dynamic imports** unless absolutely necessary.
- **Localization**: User-facing text must use `useLocalize()`. Update English keys in `client/src/locales/en/translation.json`.
- **Imports**: Package (shortest to longest) -> `import type` (longest to shortest) -> Local/project (longest to shortest).