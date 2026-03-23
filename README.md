# LM Studio Assistant for VS Code

Local coding assistant for VS Code that talks to your LM Studio OpenAI-compatible server and can use workspace tools to:
- list files
- read files
- search text
- apply edits
- write files

## Features
- Sidebar chat UI in VS Code
- Tool-using workflow for grounded file operations
- Configurable LM Studio base URL and model
- Local-first workflow (no required cloud API)

## Requirements
- VS Code `1.85.0` or newer
- LM Studio running locally with API server enabled
- An available model (for example: `openai/gpt-oss-20b`)

## Extension Settings
- `lmstudioAssistant.baseUrl` (default: `http://localhost:1234/v1`)
- `lmstudioAssistant.model` (default: `local-model`)
- `lmstudioAssistant.maxToolTurns`
- `lmstudioAssistant.maxSearchResults`
- `lmstudioAssistant.maxFileBytes`

## Development
```powershell
npm ci
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## Package for Marketplace
```powershell
npm run compile
npm run package
```

This generates a `.vsix` package in the workspace root.

## Publish to VS Code Marketplace
1. Create a publisher at https://marketplace.visualstudio.com/manage
2. Ensure publisher ID matches `package.json` -> `publisher`
3. Create an Azure DevOps PAT with Marketplace publish permissions
4. Login and publish:

```powershell
npx vsce login elliotone
npm run publish:patch
```

## Open Source and GitHub
Initialize git and push:

```powershell
git init
git add .
git commit -m "Initial open-source release"
git branch -M main
git remote add origin https://github.com/ElliotOne/lmstudio-assistant-vscode.git
git push -u origin main
```

## Notes
- Marketplace icon is set to `media/lmstudio.png` (128x128) generated from the LM Studio SVG.
