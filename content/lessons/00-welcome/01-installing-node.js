registerLesson("00-installing-node", `
---
id: 00-installing-node
title: Installing Node the Pro Way
minutes: 16
level: beginner
objectives:
  - Install Node.js using a version manager instead of the raw installer
  - Understand LTS vs Current and which to pick
  - Verify your installation and switch between versions
---

# Installing Node the Pro Way (nvm / fnm / Volta)

## Why this matters

You *could* download Node from nodejs.org and double-click an installer. Beginners do that. Professionals don't — and here's the reason: real projects pin different Node versions. One client's app needs Node 20, another needs Node 24. A single global installation means constant pain. A **version manager** lets you install many Node versions side by side and switch in one command. Setting this up now is the difference between a smooth career and years of "works on my machine" headaches.

## Learning objectives

- Install a Node version manager appropriate to your operating system.
- Understand the **LTS** vs **Current** release lines.
- Confirm Node and npm are working and switch versions on demand.

## LTS vs Current: which version?

Node ships two release lines:

- **LTS (Long-Term Support)** — even-numbered majors (20, 22, **24**...). Stable, supported for ~3 years, and what you should run in production. As of mid-2026, **Node 24 is the active LTS**.
- **Current** — the newest features, but shorter support. Great for experimenting with cutting-edge APIs.

> [!NOTE] Our rule of thumb
> Use the latest **LTS** for everything in this course. You get modern features (native \`fetch\`, the built-in test runner, native \`.env\` support, the permission model) *and* stability.

## Pick a version manager

There are three excellent choices. Any of them is fine — pick one.

| Tool | Best for | Notes |
|------|----------|-------|
| **fnm** | Most people | Blazing fast, cross-platform, written in Rust |
| **nvm** | macOS / Linux traditionalists | The original; huge community |
| **Volta** | Teams that want pinned tools | Pins Node *and* package managers per project |

### Option A — fnm (recommended)

On macOS or Linux:

~~~bash
# Install fnm
curl -fsSL https://fnm.vercel.app/install | bash

# Restart your terminal, then install and use the latest LTS
fnm install --lts
fnm use --lts
fnm default lts-latest
~~~

On Windows (PowerShell, with winget):

~~~bash
winget install Schniz.fnm
fnm install --lts
fnm use --lts
~~~

### Option B — nvm (macOS / Linux)

~~~bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Restart your terminal, then:
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
~~~

### Option C — Volta (cross-platform, pins per project)

~~~bash
curl https://get.volta.sh | bash
volta install node@lts
~~~

## Verify it worked

Open a **new** terminal and run these two commands. (These are real terminal commands — run them on your own machine, not in the browser.)

~~~bash
node --version
npm --version
~~~

You should see something like this:

> [!OUTPUT]
> v24.2.0
> 11.3.0

If you see version numbers, you're done — Node *and* npm (which comes bundled with Node) are installed. 🎉

## Switching versions is now trivial

This is the payoff. Want to test your code on an older Node?

~~~bash
# Install and switch to Node 20 for a moment
fnm install 20
fnm use 20
node --version   # v20.x.x

# Switch back to the latest LTS
fnm use --lts
~~~

> [!PRINCIPAL] Pin Node per project
> Add a file named \`.nvmrc\` (or \`.node-version\`) to each project containing just the version, e.g. \`24\`. Then \`fnm use\` or \`nvm use\` (with no argument) reads that file and switches automatically. Better still, Volta records the exact version inside \`package.json\` so *every* teammate runs the same Node without thinking about it. Reproducibility is a principal-engineer value — and it starts here.

## Pitfalls

> [!PITFALL] "Command not found" after installing
> Almost always this means your shell hasn't loaded the version manager yet. **Close and reopen your terminal** (or run \`source ~/.bashrc\` / \`source ~/.zshrc\`). The installer prints the exact line to add to your shell config — read that output.

> [!WARNING] Don't mix a manual install with a version manager
> If you previously installed Node from the website, uninstall it first. Two Node installations fighting over your \`PATH\` causes baffling bugs. Let the version manager own Node entirely.

## What you learned

- Professionals manage Node with **fnm / nvm / Volta**, never a single global install.
- Run the latest **LTS** (Node 24 in 2026) for the best mix of features and stability.
- \`node --version\` and \`npm --version\` confirm your setup.
- Pinning a version per project keeps your whole team reproducible.

## Next steps

You have Node installed. Next, you'll write and run your very first program — three different ways — and meet the REPL, your new best friend for quick experiments.
`);
