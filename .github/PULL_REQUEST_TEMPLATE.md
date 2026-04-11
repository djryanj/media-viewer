## Description

<!-- Describe your changes in detail -->

## Type of Change

<!-- Mark the appropriate option with an "x" -->

- [ ] `feat`: New feature
- [ ] `fix`: Bug fix
- [ ] `docs`: Documentation changes
- [ ] `style`: Changes that don't affect code meaning (formatting, etc)
- [ ] `refactor`: Code change that neither fixes a bug nor adds a feature
- [ ] `perf`: Performance improvement
- [ ] `test`: Adding or updating tests
- [ ] `chore`: Changes to build process or auxiliary tools
- [ ] `build`: Changes that affect the build system or dependencies
- [ ] `breaking`: Breaking change (add `!` after type, e.g., `feat!:`)
- [ ] `release`: Release a new version

## Component

<!-- Which component does this PR affect? -->

- [ ] Database
- [ ] Frontend/UI
- [ ] API/Handlers
- [ ] Media Processing (thumbnails, transcoding)
- [ ] Search/Indexing
- [ ] Tags / AutoTagger
- [ ] Favorites
- [ ] Docker
- [ ] Documentation
- [ ] Metrics/Monitoring
- [ ] Other: **\_**

## Checklist

- [ ] My PR title follows the [Conventional Commits](https://www.conventionalcommits.org/) format
    - Example: `feat(api): add video streaming endpoint`
    - Example: `fix(database): resolve connection timeout issue`
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have run `make pr-check` and all relevant checks passed
    - Backend changes: `make lint`, `make test`, and `make test-race`
    - Frontend changes: `make frontend-check`, `make frontend-test-unit`, `make frontend-test-integration-auto`, and `make frontend-test-e2e-smoke-auto`
- [ ] If I needed Go lint autofixes before rerunning checks, I used `make pr-check-fix`

### Frontend PR Checks

- [ ] If this PR changes frontend flows outside the smoke subset, I also ran broader or focused browser coverage such as `make frontend-test-e2e`, `make frontend-test-e2e-file <spec>`, or `make frontend-test-e2e-module <tag>`
- [ ] If this PR intentionally changes UI presentation, I ran `make frontend-test-e2e-visual`
- [ ] If this PR intentionally changes committed visual baselines, I ran `make frontend-test-e2e-visual-baselines` and included the updated artifacts
- [ ] If this PR refreshes documentation imagery, I ran `make frontend-test-e2e-docs-screenshots` and included the updated `docs/images/` assets
- [ ] If this PR affects performance-sensitive frontend flows, I ran the relevant `make frontend-test-e2e-performance*` lane

## Related Issues

<!-- Link related issues here -->

Closes #
Related to #

## Additional Notes

<!-- Any additional information -->
