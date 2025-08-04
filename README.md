# Secure Notes

Secure, encrypted note-taking extension for Visual Studio Code.  
- All notes encrypted-on-disk (`.enc`) and edited as `.md`
- Optional Git sync for your notes
- Folder support in explorer

## Features
A note taking plugin for vscode editor. This plugin would appear similar to other note taking plugins in the left panel.
* This extension saves the files encrypted on the disk.
* On decryption this file keeps its original extension (markdown).
* These encrypted files can be synced to a remote git repository.
* Supports child directories

## Requirements


## Extension Settings


## Known Issues


## Release Notes

### 0.1.0

Initial release with following features.

#### **Key Features Implemented**

*  **Security**
- AES-256-GCM encryption for all notes
- Password-based key derivation using scrypt
- Files stored with `.enc` extension on disk
- Password required each time extension starts

*  **Git Integration**
- Automatic repository initialization
- Auto-commit on file close with timestamp
- Optional remote repository push
- Sync command for manual synchronization

*  **User Experience**
- Tree view in Explorer panel
- Context menus for file operations
- Temporary .md files for editing
- Support for nested directories
- Visual feedback and error handling

*  **File Management**
- Create new notes and folders
- Delete notes/folders with confirmation
- Automatic encryption/decryption workflow
- Preserves markdown extension during editing

**Enjoy!**
