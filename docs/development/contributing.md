# Contributing

Thank you for your interest in contributing to Media Viewer. This guide covers how to get started.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm
- Git

### Development Setup

1. Fork the repository on GitHub

2. Clone your fork:

    ```bash
    git clone https://github.com/your-username/media-viewer.git
    cd media-viewer
    ```

3. Install dependencies:

    ```bash
    npm install
    ```

4. Create a `.env` file:

    ```bash
    PASSWORD=devpassword
    MEDIA_PATH=/path/to/test/media
    ```

5. Start the development server:

    ```bash
    npm run dev
    ```

6. Open `http://localhost:8080` in your browser

## Project Structure

```
media-viewer/
├── public/           # Static frontend files
│   ├── css/          # Stylesheets
│   ├── js/           # JavaScript modules
│   └── index.html    # Main HTML file
├── src/              # Backend source code
├── docs/             # Documentation
├── tests/            # Test files
└── package.json
```

## Making Changes

### Branching

Create a feature branch from `main`:

```bash
git checkout -b feature/your-feature-name
```

### Code Style

- Follow existing code patterns
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

### Frontend

- JavaScript modules are in `public/js/`
- Styles are in `public/css/style.css`
- Use CSS variables for colors and spacing
- Test on both desktop and mobile

### Backend

- Server code is in `src/`
- Follow RESTful API conventions
- Handle errors gracefully
- Log meaningful messages

## Testing

Run the test suite:

```bash
npm test
```

Test your changes manually:

- Test on desktop browsers (Chrome, Firefox, Safari)
- Test on mobile devices or emulators
- Test with different media types
- Test edge cases (empty folders, large libraries)

## Submitting Changes

### Commit Messages

Write clear, descriptive commit messages:

```
Add tag copy/paste functionality

- Add Copy Tags button for single item selection
- Add Paste Tags button with confirmation modal
- Add Merge Tags for multi-item selection
- Add keyboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+M)
```

### Pull Requests

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill out the pull request template
4. Link any related issues

### Pull Request Checklist

- [ ] Code follows project style
- [ ] Changes are tested
- [ ] Documentation is updated (if needed)
- [ ] Commit messages are clear
- [ ] No unrelated changes included

## Reporting Issues

### Bug Reports

Include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser and device information
- Screenshots if applicable

### Feature Requests

Include:

- Clear description of the feature
- Use case / why it's needed
- Any implementation ideas

## Questions

For questions about contributing, open a discussion on GitHub or reach out to the maintainers.
