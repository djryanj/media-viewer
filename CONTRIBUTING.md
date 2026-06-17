# Contributing to Media Viewer

Thank you for considering contributing to Media Viewer!

## Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that don't affect code meaning (formatting, whitespace)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or correcting tests
- **build**: Changes to build system or dependencies
- **ci**: Changes to CI configuration files and scripts
- **chore**: Other changes that don't modify src or test files

### Scopes

Common scopes include:

- `api` - API/handler changes
- `database` - Database-related changes
- `ui` - User interface changes
- `thumbnails` - Thumbnail generation
- `transcoding` - Video transcoding
- `search` - Search functionality
- `tags` - Tag system
- `favorites` - Favorites system
- `docker` - Docker configuration

### Examples

```bash
# Feature
git commit -m "feat(api): add video streaming endpoint"

# Bug fix
git commit -m "fix(database): resolve connection pool exhaustion"

# Documentation
git commit -m "docs(readme): add installation instructions"

# Breaking change
git commit -m "feat(api)!: change authentication to session-based

BREAKING CHANGE: Token-based auth is no longer supported.
Migrate to session-based authentication."

# Multiple scopes
git commit -m "feat(api,database): add tag filtering to search"
```

## Pull Request Process

1. **Branch naming**: Use conventional commit type as prefix
    - `feat/add-video-streaming`
    - `fix/database-timeout`
    - `docs/update-readme`

2. **PR Title**: Must follow conventional commit format
    - Good: `feat(api): add playlist support`
    - Bad: `Added playlist support`

3. **PR Description**: Use the provided template

4. **Labels**: Will be automatically added based on your PR title and changes

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes following conventional commits
4. Run tests and checks: `make pr-check` (recommended)
5. Push and create a PR

## Testing Your Changes

Before submitting a pull request, ensure your changes pass all checks:

### Quick PR Check (Recommended)

Run all pre-submission checks in one command:

```bash
make pr-check
```

This runs:

1. Backend checks when Go-related files changed: lint (`make lint`), backend tests (`make test`), and race detection (`make test-race`)
2. Frontend checks when frontend files changed: ESLint (`make frontend-lint`), Prettier format check (`make frontend-format-check`), and svelte-check/TypeScript types (`make frontend-check`), followed by frontend unit tests (`make frontend-test-unit`) and the Chromium smoke suite with an ephemeral server (`make frontend-test-e2e-smoke-auto`)
3. No-op when no Go or frontend-tracked files changed, unless you force it with `make pr-check FORCE=1`

Use `make pr-check-fix` when you want the same flow but with Go lint autofixes applied before the backend tests run.

`make pr-check` does not run broader Playwright coverage outside smoke, visual regression, docs screenshot generation, or performance lanes. Run those separately when the PR checklist below calls for them.

Test output is automatically saved to log files such as `test.log`, `race.log`, and the frontend command logs emitted by the invoked sub-targets.

### Individual Test Commands

You can also run tests individually:

```bash
# Run all tests
make test

# Run tests for specific packages
make test-package database handlers

# Run tests with race detector
make test-race

# Run only unit tests (fast)
make test-unit

# Run only integration tests
make test-integration

# Run tests with coverage
make test-coverage database

# Run linting
make lint

# Fix linting issues automatically
make lint-fix
```

### Test Log Files

Test output is automatically logged:

- `test.log` - Full test output
- `race.log` - Race detector output
- `<package>.log` - Output for specific package tests
- `coverage-<package>.log` - Coverage test output

Clean up test artifacts with:

```bash
make test-clean
```

### Frontend E2E Lanes

Frontend browser coverage is intentionally split so routine PR checks stay fast and deterministic:

```bash
# Default browser E2E lane for normal feature work
make frontend-test-e2e

# Stable Chromium smoke lane used by CI for routine PR coverage
make frontend-test-e2e-smoke

# Separate visual regression lane against committed JSON baselines
make frontend-test-e2e-visual

# Refresh committed visual snapshot baselines after intentional UI changes
make frontend-test-e2e-visual-baselines

# Opt-in docs screenshot generation workflow that writes PNGs to docs/images/
make frontend-test-e2e-docs-screenshots
```

Notes:

- `make frontend-test-e2e` / `npm run test:e2e` excludes `@performance` specs and docs screenshot-generation specs by default.
- Visual regression is a separate lane that compares Playwright screenshot baselines stored as PNGs in `frontend/e2e/snapshots/`.
- Docs screenshot generation is also separate and should only be run when documentation images in `docs/images/` need to be refreshed.
- All integration, E2E, visual, and docs screenshot commands require a backend unless you use the corresponding `*-auto` Make targets.

### PR Checklist

Use this checklist to decide which local test lane to run before opening or updating a PR:

- Run `make pr-check` for the standard local PR gate. It covers backend lint/test/race checks plus frontend check/unit/integration/smoke when matching files changed.
- If you want Go lint issues auto-fixed before rerunning the same local PR gate, use `make pr-check-fix`.
- If the PR changes frontend flows outside the smoke subset, also run `make frontend-test-e2e` or a focused target such as `make frontend-test-e2e-file <spec>` or `make frontend-test-e2e-module <tag>`.
- If the PR intentionally changes visual output or committed UI baselines, run `make frontend-test-e2e-visual`. If the new visuals are expected, regenerate baselines with `make frontend-test-e2e-visual-baselines` and include the updated artifacts in the PR.
- If the PR refreshes documentation imagery, run `make frontend-test-e2e-docs-screenshots` and include the updated `docs/images/` assets in the PR.
- If the PR touches performance-sensitive frontend flows, run the relevant `make frontend-test-e2e-performance*` lane manually. Performance specs are excluded from the default E2E path and are not part of the routine PR smoke lane.

## Release Process

Two `make` targets handle the full release workflow.

**Step 1 — prepare the release branch** (run from a clean `main`):

```bash
make prepare-release VERSION=v0.15.0
```

This creates `release/v0.15.0`, bumps `frontend/package.json` to `0.15.0`, stamps the `CHANGELOG.md` date, commits both files, and pushes the branch. Open a PR from `release/v0.15.0` → `main`, review it, then merge.

**Step 2 — tag** (run from `main` after the PR is merged):

```bash
git checkout main && git pull origin main
make tag-release VERSION=v0.15.0
```

This verifies the changelog entry is dated (not `Unreleased`), creates an annotated `v0.15.0` tag, and pushes it. Pushing the tag fires the existing `release.yml` workflow, which runs all tests, builds Docker images, generates SBOMs, and creates the GitHub Release.

Both targets accept `VERSION=v0.15.0` or `VERSION=0.15.0` (the `v` prefix is optional).

## Questions?

Open an issue for discussion or clarification.
