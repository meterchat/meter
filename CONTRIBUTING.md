# Contributing to Meter

Thanks for your interest in contributing to Meter. This document provides guidelines and information for contributors.

## Getting Started

1. Clone the repository: `git clone https://github.com/meterchat/meter.git`
2. Install dependencies: `bun install`
3. Copy environment variables: `cp .env.example .env.local`
4. Start the dev server: `bun dev`

## Development

```bash
bun dev        # Start dev server (Turbopack)
bun run build  # Production build
bun run lint   # Run ESLint
```

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/hooks/` — Custom React hooks
- `src/lib/` — Shared utilities, state management, model definitions

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure the build passes: `bun run build`
4. Ensure linting passes: `bun run lint`
5. Write a clear PR description explaining what changed and why
6. Submit the PR

## Code Style

- TypeScript strict mode
- Functional components with hooks
- Tailwind CSS for styling (no CSS modules)
- Zustand for state management
- Keep files under ~700 lines; split if larger

## Reporting Issues

Open a [GitHub Issue](https://github.com/meterchat/meter/issues) with:

- A clear title and description
- Steps to reproduce (if applicable)
- Expected vs actual behavior
- Browser/OS information

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
