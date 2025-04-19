# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [1.35.0]

- Support for DBGp stream command
- Avoid conflict with full screen F11 shortcut
- Improve existing unix socket handling
- Improve close socket handling

## [1.34.0]

- Partial support for virtual workspaces

## [1.33.1]

- Fix editor title run/debug button.

## [1.33.0]

- Add skipEntryPaths to immediately detach a debug session depending on entry path.
- Remove EvaluatableExpression Provider.

## [1.32.1]

- Fix logging of cloud connection.
- Fix ignore exceptions patterns and namespaces.

## [1.32.0]

- New launch setting ignoreExceptions.

## [1.31.1]

- Fix relative paths and path mappings support.

## [1.31.0]

- Allow more flexible path mappings in url format.

## [1.30.0]

- Add skipFiles launch setting to skip over specified file patterns.

## [1.29.1]

- Fix for env configuration check that sometimes causes an error.

## [1.29.0]

- Xdebug Cloud support.

## [1.28.0]

- Support for envFile.
- Migrated from tslint to eslint.

## [1.27.0]

- Variable paging with VSCode indexedVariables.
- Enable return value stepping with breakpoint_include_return_value.

## [1.26.1]

- Fixed typo in error message for unexpected env. Extended error message with more detail.

## [1.26.0]

- Support for Unix Domain sockets #777
- Improve ExitedEvent notification #763
- Improve Debug Console (Eval) handling of nested vars #764
- Fixed missing TerminalHelper script #762

## [1.25.0]

- Implement delayed stack loading with startFrame and levels argument to StackTrace Request

## [1.24.3]

- Fix for broken property traversal #755

## [1.24.2]

- Additional fix for extended root property in eval #751

## [1.24.1]

- Fix for extended root property #751

## [1.24.0]

- F10/F11 start debugging with stop on entry.

## [1.23.0]

- When `env` is specified in launch configuration it will be merged the process environment.
- Set variable support.
- Improved hover support.
- Update publisher id.

## [1.22.0]

### Added

- DBGp Proxy support.
- `php.debug.ideKey` setting to set the Proxy IDE key globally.

### Changed

- Renamed `php.executablePath` setting to `php.debug.executablePath` and do not fallback to `php.validate.executablePath`.
- Untrusted workspace settings.
- Default protocol encoding changed to utf-8.

## [1.21.1]

### Fixed

- Auto configure runtimeExecutable when only runtimeArgs are used (built-in web server).
- Improve handling of broken clients on failed initPacket.

## [1.21.0]

### Added

- Support for maxConnections limiting how many parallel connections the debug adapter allows.

## [1.20.0]

### Added

- Support no-folder debugging in (purple) VS Code.

## [1.19.0]

### Added

- Support for PHP 8.1 facets
- Support for Xdebug 3.1 xdebug_notify()

## [1.18.0]

- Added hit count breakpoint condition.

## [1.17.0]

### Added

- Added logpoint support.

## [1.16.3]

### Fixed

- Fixed semver dependency error.

## [1.16.2]

### Fixed

- Fixed breakpoint and launch initialization order.
- Optimize feature negotiation for known Xdebug version.

## [1.16.1]

### Fixed

- Do not request all breakpoints on every new Xdebug connection. Use internal BreakpointManager state.
- Show breakpoints as verified when there are no connections.

## [1.16.0]

### Added

- Option to start PHP built-in web server without router script.
- Extended logging with DBGp packets.
- Extended properties support. Always enable extended properties so fields are decoded in UTF-8.

### Changed

- Switched to Xdebug 3 default port 9003.
- Changed default exception breakpoint settings to all off.

### Fixed

- Internal Source Reference for virtual source files fixed - when stepping into eval()

## [1.15.1]

### Changed

- Defined under packages.json this extension should be preferred for PHP debugging.

## [1.15.0]

### Added

- Support for terminateDebuggee option letting the user choose to keep the debuggee running. Press Alt when hovering over stop action.
- Handle breakpoints in a async manner.

### Changed

- Do not display error dialog on failed eval
