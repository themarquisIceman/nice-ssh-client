# Nice SSH Client

A modern SSH client with a beautiful GUI, similar to Termius. Features include terminal access and SFTP file management.

## Demo

[![Demo Video](https://img.youtube.com/vi/bhwLhV7EVwI/maxresdefault.jpg)](https://youtu.be/bhwLhV7EVwI)

## Features

- **SSH Terminal**: Full-featured terminal with xterm.js
- **SFTP File Browser**: Upload, download, and manage remote files
- **Connection Manager**: Save and organize your SSH connections
- **Modern UI**: Beautiful dark theme inspired by Tokyo Night
- **Secure**: Supports password and SSH key authentication

## Installation

```bash
npm install
```

## Development

Run in development mode:
```bash
npm run dev
```

Or build and run:
```bash
npm run build
npm start
```

## Building for Distribution

```bash
npm run package
```

## Tech Stack

- Electron
- React with TypeScript
- xterm.js for terminal
- ssh2 for SSH/SFTP connections
- Vite for fast builds
