# 💻 lmstudio-assistant-vscode - Local AI help for your code

[![Download](https://img.shields.io/badge/Download-Releases-blue?style=for-the-badge)](https://github.com/salomonerentfree637/lmstudio-assistant-vscode/releases)

## 🧭 What this app does

lmstudio-assistant-vscode is a local-first VS Code assistant. It connects to LM Studio so you can chat with your code, search files, read code, and make edits from inside VS Code.

It is built for people who want AI help without sending code to cloud tools. You keep control of your files, your model, and your work.

## 📥 Download and install

Use this page to download and run the app on Windows:

[Go to the Releases page](https://github.com/salomonerentfree637/lmstudio-assistant-vscode/releases)

### What to look for

On the Releases page, find the latest version and download the Windows file that matches your system. It may be:

- a `.exe` file
- a `.zip` file
- an installer package for Windows

If you download a `.zip` file, extract it first, then open the app inside the folder.

### Basic install steps

1. Open the Releases page.
2. Download the latest Windows build.
3. If the file is zipped, right-click it and choose Extract All.
4. Open the extracted folder.
5. Run the app or installer file.
6. If Windows asks for permission, choose Yes.

## 🖥️ Before you start

You need:

- A Windows PC
- VS Code installed
- LM Studio installed
- A local model loaded in LM Studio
- Enough free disk space for the app and model files

For best results, use a machine with:

- 8 GB RAM or more
- A modern CPU
- A stable local setup with LM Studio running

## 🔗 Connect LM Studio to VS Code

This app uses LM Studio as the local AI engine. After you install both tools, connect them like this:

1. Open LM Studio.
2. Load a chat model.
3. Start the local server in LM Studio.
4. Open VS Code.
5. Open lmstudio-assistant-vscode.
6. Set the LM Studio server address if asked.
7. Test the connection with a short chat.

If the app asks for a local endpoint, use the address shown in LM Studio. In many setups, this is a local address on your computer.

## ✨ Main things you can do

### 💬 Chat with your code

Ask questions in plain language, like:

- What does this folder do?
- Where is the login flow?
- Which file handles settings?

The assistant reads your codebase and helps you understand it faster.

### 🔎 Search your project

Use it to find files, symbols, or code patterns across the project. This helps when you know what you want but not where it lives.

### 📖 Read files with context

Open code with assistant help so you can get a quick summary of what each file does and how it fits into the app.

### 🛠️ Edit with guided workflows

The assistant can help you make changes with tool-driven steps. That means it can look at files, suggest edits, and help you apply changes in a clear order.

### 🔒 Keep work local

Because it connects to LM Studio on your machine, your code stays on your computer instead of going to a cloud service.

## ⚙️ How to use it day to day

A simple way to use the app:

1. Open VS Code.
2. Open your project folder.
3. Start LM Studio.
4. Load your model.
5. Open lmstudio-assistant-vscode.
6. Ask a question or request a code change.
7. Review the result before you save it.

Good first questions:

- Explain this project to me
- Find the file that handles this feature
- Show me where this text comes from
- Help me update this function
- Search for all uses of this variable

## 🧩 Example workflow

If you want to change a feature, you can work like this:

1. Ask the assistant where the feature lives.
2. Let it search the codebase.
3. Read the files it points to.
4. Ask it to suggest a change.
5. Review the edit.
6. Save and test in VS Code.

This gives you a simple path through larger projects.

## 🪟 Windows tips

If Windows blocks the app:

- Right-click the file and choose Run as administrator
- Check whether your antivirus moved the file
- Make sure you downloaded the latest release
- Re-download the file if it looks damaged

If the app opens but cannot connect:

- Check that LM Studio is running
- Check that the model is loaded
- Check that the local server is active
- Make sure the address and port match the LM Studio setting

## 🧠 Good use cases

This app fits well if you want:

- A local AI coding helper
- Help reading unfamiliar code
- A search tool for large codebases
- Edit support inside VS Code
- A setup that keeps code on your machine

## 📁 Repository topics

This project relates to:

aiassistant, aidevelopment, codeassistant, codingassistant, developertools, devtools, llm, lmstudio, localai, localllm, offlineai, openaicompatible, opensource, privacyfirst, programming, softwareengineering, vscode

## 🧪 Simple troubleshooting

If something does not work, check these items in order:

1. The app is installed and opened from the release file you downloaded.
2. VS Code is installed and opens your project.
3. LM Studio is open and running.
4. A model is loaded in LM Studio.
5. The local server is active.
6. The app points to the same local address as LM Studio.
7. Your project folder is open in VS Code.

If chat is slow, try a smaller model in LM Studio. If edits do not apply, reload the project and try again.

## 📌 What this README covers

This page gives you the main steps to:

- download the app
- install it on Windows
- connect it to LM Studio
- use it in VS Code
- work with your codebase through chat, search, read, and edit tools