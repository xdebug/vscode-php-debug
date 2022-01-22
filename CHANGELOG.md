# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

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
