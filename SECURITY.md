# Security Policy

## Supported versions

Security fixes are applied to the latest `main` branch of [usertypo/usertypo](https://github.com/usertypo/usertypo).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email a private report to: **contactus@usertypo.com**

Include:

- A short description of the issue
- Steps to reproduce (or a proof-of-concept)
- Impact (what an attacker could do)
- Your preferred contact if follow-up is needed

We will acknowledge reports when we can and work on a fix before any public disclosure.

## What is not a vulnerability

- Publishable Clerk keys (`pk_…`) and Supabase anon/publishable keys shipping in the browser
- Ability to fork or read this open-source repository
- Ads/`ads.txt` placeholders (empty until a third-party ad provider is configured)

The live app is hosted on Cloudflare Pages. Multiplayer and leaderboards run on Cloudflare Workers. See [docs/architecture.md](./docs/architecture.md).
