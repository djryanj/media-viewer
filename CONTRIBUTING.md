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

1. Lint fixes (`make lint-fix`)
2. Full test suite (`make test`)
3. Race detector (`make test-race`)

All test output is automatically saved to log files (`test.log`, `race.log`) for your review.

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

## Release Process

Releases are automated when tags are pushed:

1. Commits are analyzed for version bumping:
    - `fix:` → patch version (1.0.x)
    - `feat:` → minor version (1.x.0)
    - `feat!:` or `BREAKING CHANGE:` → major version (x.0.0)

2. Changelog is automatically generated from commits

3. Docker images are built and pushed to GHCR

## Questions?

Open an issue for discussion or clarification.
