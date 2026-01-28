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
4. Run linting: `golangci-lint run`
5. Test your changes: `docker-compose up`
6. Push and create a PR

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
