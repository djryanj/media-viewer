# Contributing

Thank you for your interest in contributing to Media Viewer!

For complete contributing guidelines, please see the [CONTRIBUTING.md](https://github.com/djryanj/media-viewer/blob/main/CONTRIBUTING.md) file in the root of the repository.

## Quick Links

- **[Report a Bug](https://github.com/djryanj/media-viewer/issues/new?template=bug_report.md)** - Found an issue? Let us know
- **[Request a Feature](https://github.com/djryanj/media-viewer/issues/new?template=feature_request.md)** - Have an idea? We'd love to hear it
- **[Discussions](https://github.com/djryanj/media-viewer/discussions)** - Ask questions or share ideas

## Overview

The main contributing guide covers:

- Setting up your development environment
- Code style guidelines
- Testing requirements
- Pull request process
- Commit message conventions
- Issue reporting templates

## Before Opening A PR

Use the root guide for the full workflow, but these are the checks most contributors need day to day:

```bash
# Recommended all-in-one pre-PR check
make pr-check

# Default frontend browser E2E lane
make frontend-test-e2e

# Separate visual regression lane
make frontend-test-e2e-visual

# Refresh visual snapshot baselines after intentional UI changes
make frontend-test-e2e-visual-baselines

# Refresh documentation screenshots only when docs/images/ assets need updating
make frontend-test-e2e-docs-screenshots
```

Notes:

- `make pr-check` runs backend lint/test/race checks for Go-related changes and frontend check/unit/integration/smoke checks for frontend changes.
- `make pr-check-fix` runs the same flow but uses Go lint autofix before the backend test steps.
- `make pr-check` does not run broader Playwright coverage outside smoke, visual regression, docs screenshot generation, or performance lanes.
- The default frontend E2E lane excludes performance specs and docs screenshot-generation specs.
- Visual regression coverage is separate and compares deterministic JSON baselines under `static/e2e/baselines/tagging/`.
- Docs screenshot generation is also separate and writes PNG assets into `docs/images/`.
- See [testing.md](testing.md) for the complete testing matrix and command reference.

## PR Checklist

Use this short checklist before opening or updating a pull request:

- Run `make pr-check` for the standard local PR gate. It covers backend lint/test/race checks plus frontend check/unit/integration/smoke when matching files changed.
- If you want Go lint issues auto-fixed before rerunning the same local PR gate, use `make pr-check-fix`.
- If the PR changes frontend flows outside the smoke subset, also run `make frontend-test-e2e` or a focused target such as `make frontend-test-e2e-file <spec>` or `make frontend-test-e2e-module <tag>`.
- If the PR intentionally changes visuals, run `make frontend-test-e2e-visual`. If the new output is expected, regenerate baselines with `make frontend-test-e2e-visual-baselines` and include the updated artifacts in the PR.
- If the PR refreshes docs imagery, run `make frontend-test-e2e-docs-screenshots` and include the updated `docs/images/` assets in the PR.
- If the PR touches performance-sensitive frontend flows, run the relevant `make frontend-test-e2e-performance*` lane manually.

## Documentation

If you're specifically interested in contributing to documentation:

1. Documentation is written in Markdown
2. Source files are in the `docs/` directory
3. Built with MkDocs Material theme
4. Follow the [MkDocs documentation](https://www.mkdocs.org/) for formatting

To preview documentation changes locally:

```bash
make docs-serve
```

Then open `http://localhost:8000` in your browser.

## Getting Help

If you have questions about contributing:

- Check the [Architecture documentation](architecture.md) for technical details
- Open a [Discussion](https://github.com/djryanj/media-viewer/discussions)
- Comment on an existing issue

We appreciate your contributions!
