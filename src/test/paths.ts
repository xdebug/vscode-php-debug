
import {isSameUri, convertClientPathToDebugger, convertDebuggerPathToClient} from '../paths';
import * as assert from 'assert';

describe('paths', () => {
    let undef: string;

    const pathMapping = {
        // local >> remote
        // unix to unix
        'unixToUnix': {
            '/home/felix/mysite': '/var/www',
            '/home/felix/mysource': '/app'
        },
        // unix to windows
        'unixLocalToWindowsServer': {
            '/home/felix/mysite': 'C:\\Program Files\\Apache\\2.4\\htdocs',
            '/home/felix/mysource': 'C:\\Program Files\\MySource'
        },
        // windows to unix
        'windowsServerToUnixLocal': {
            '/home/felix/mysite': 'C:\\Program Files\\Apache\\2.4\\htdocs',
            '/home/felix/mysource': 'C:\\Program Files\\MySource'
        },
        // windows to unix
        'windowsLocalToUnixServer': {
            'C:\\Users\\felix\\mysite': '/var/www',
            'C:\\Users\\felix\\mysource': '/app'
        },
        // unix to windows
        'unixServerToWindowsLocal': {
            'C:\\Users\\felix\\mysite': '/var/www',
            'C:\\Users\\felix\\mysource': '/app'
        },
        // windows to windows
        'windowsToWindows': {
            'C:\\Users\\felix\\mysite': 'C:\\Program Files\\Apache\\2.4\\htdocs',
            'C:\\Users\\felix\\mysource': 'C:\\Program Files\\MySource'
        },
        // local test paths
        'local': {
            'unix': {
                'site': '/home/felix/mysite/site.php',
                'source': '/home/felix/mysource/source.php'
            },
            'windows': {
                'site': 'C:\\Users\\felix\\mysite\\site.php',
                'source': 'C:\\Users\\felix\\mysource\\source.php'
            }
        },
        // server test paths
        'remote': {
            'unix': {
                'site': 'file:///var/www/site.php',
                'source': 'file:///app/source.php'
            },
            'windows': {
                'site': 'file:///C:/Program%20Files/Apache/2.4/htdocs/site.php',
                'source': 'file:///C:/Program%20Files/MySource/source.php'
            }
        }
    };

    describe('isSameUri', () => {
        it('should compare to URIs', () => {
            assert.strictEqual(isSameUri('file:///var/www/test.php', 'file:///var/www/test.php'), true);
            assert.strictEqual(isSameUri('file:///var/www/test.php', 'file:///var/www/test2.php'), false);
        });
        it('should compare windows paths case-insensitive', () => {
            assert.strictEqual(isSameUri('file:///C:/Program%20Files/Apache/2.4/htdocs/test.php', 'file:///c:/Program%20Files/Apache/2.4/htdocs/test.php'), true);
            assert.strictEqual(isSameUri('file:///C:/Program%20Files/Apache/2.4/htdocs/test.php', 'file:///C:/Program%20Files/Apache/2.4/htdocs/test2.php'), false);
        });
    });
    describe('convertClientPathToDebugger', () => {
        describe('without source mapping', () => {
            it('should convert a windows path to a URI', () => {
                assert.equal(convertClientPathToDebugger('C:\\Users\\felix\\test.php'), 'file:///C:/Users/felix/test.php');
            });
            it('should convert a unix path to a URI', () => {
                assert.equal(convertClientPathToDebugger('/home/felix/test.php'), 'file:///home/felix/test.php');
            });
        });
        describe('with source mapping', () => {
            it('should convert a unix path to a unix URI', () => {
                const localSourceRoot = '/home/felix/myproject';
                const serverSourceRoot = '/var/www';
                assert.equal(
                    convertClientPathToDebugger('/home/felix/myproject/test.php', localSourceRoot, serverSourceRoot),
                    'file:///var/www/test.php'
                );
            });
            it('should convert a unix path to a windows URI', () => {
                const localSourceRoot = '/home/felix/myproject';
                const serverSourceRoot = 'C:\\Program Files\\Apache\\2.4\\htdocs';
                assert.equal(
                    convertClientPathToDebugger('/home/felix/myproject/test.php', localSourceRoot, serverSourceRoot),
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/test.php'
                );
            });
            it('should convert a windows path to a unix URI', () => {
                const localSourceRoot = 'C:\\Users\\felix\\myproject';
                const serverSourceRoot = '/var/www';
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\myproject\\test.php', localSourceRoot, serverSourceRoot),
                    'file:///var/www/test.php'
                );
            });
            it('should convert a windows path to a windows URI', () => {
                const localSourceRoot = 'C:\\Users\\felix\\myproject';
                const serverSourceRoot = 'C:\\Program Files\\Apache\\2.4\\htdocs';
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\myproject\\test.php', localSourceRoot, serverSourceRoot),
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/test.php'
                );
            });
        });

        describe('with path mapping', () => {
            let sources = pathMapping.local;
            let results = pathMapping.remote;

            // unix to unix
            it('should convert a unix path to a unix URI', () => {
                // site
                assert.equal( convertClientPathToDebugger(sources.unix.site, undef, undef, pathMapping.unixToUnix), results.unix.site );
                // source
                assert.equal( convertClientPathToDebugger(sources.unix.source, undef, undef, pathMapping.unixToUnix), results.unix.source );
            });

            // unix to windows
            (process.platform === 'win32' ? it : it.skip)('should convert a unix path to a windows URI', () => {
                // site
                assert.equal( convertClientPathToDebugger(sources.unix.site, undef, undef, pathMapping.unixLocalToWindowsServer), results.windows.site );
                // source
                assert.equal( convertClientPathToDebugger(sources.unix.source, undef, undef, pathMapping.unixLocalToWindowsServer), results.windows.source );
            });

            // windows to unix
            it('should convert a windows path to a unix URI', () => {
                // site
                assert.equal( convertClientPathToDebugger(sources.windows.site, undef, undef, pathMapping.windowsLocalToUnixServer), results.unix.site );
                // source
                assert.equal( convertClientPathToDebugger(sources.windows.source, undef, undef, pathMapping.windowsLocalToUnixServer), results.unix.source );
            });

            // windows to windows
            (process.platform === 'win32' ? it : it.skip)('should convert a windows path to a windows URI', () => {
                // site
                assert.equal( convertClientPathToDebugger(sources.windows.site, undef, undef, pathMapping.windowsToWindows), results.windows.site );
                // source
                assert.equal( convertClientPathToDebugger(sources.windows.source, undef, undef, pathMapping.windowsToWindows), results.windows.source );
            });
        });
    });
    describe('convertDebuggerPathToClient', () => {
        describe('without source mapping', () => {
            (process.platform === 'win32' ? it : it.skip)('should convert a windows URI to a windows path', () => {
                assert.equal(convertDebuggerPathToClient('file:///C:/Users/felix/test.php'), 'C:\\Users\\felix\\test.php');
            });
            (process.platform !== 'win32' ? it : it.skip)('should convert a unix URI to a unix path', () => {
                assert.equal(convertDebuggerPathToClient('file:///home/felix/test.php'), '/home/felix/test.php');
            });
        });
        describe('with source mapping', () => {
            (process.platform !== 'win32' ? it : it.skip)('should convert a unix URI to a unix path', () => {
                const localSourceRoot = '/home/felix/myproject';
                const serverSourceRoot = '/var/www';
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/test.php', localSourceRoot, serverSourceRoot),
                    '/home/felix/myproject/test.php'
                );
            });
            (process.platform !== 'win32' ? it : it.skip)('should convert a windows URI to a unix path', () => {
                const localSourceRoot = '/home/felix/myproject';
                const serverSourceRoot = 'C:\\Program Files\\Apache\\2.4\\htdocs';
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/Apache/2.4/htdocs/test.php', localSourceRoot, serverSourceRoot),
                    '/home/felix/myproject/test.php'
                );
            });
            (process.platform === 'win32' ? it : it.skip)('should convert a unix URI to a windows path', () => {
                const localSourceRoot = 'C:\\Users\\felix\\myproject';
                const serverSourceRoot = '/var/www';
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/test.php', localSourceRoot, serverSourceRoot),
                    'C:\\Users\\felix\\myproject\\test.php'
                );
            });
            (process.platform === 'win32' ? it : it.skip)('should convert a windows URI to a windows path', () => {
                const localSourceRoot = 'C:\\Users\\felix\\myproject';
                const serverSourceRoot = 'C:\\Program Files\\Apache\\2.4\\htdocs';
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/Apache/2.4/htdocs/test.php', localSourceRoot, serverSourceRoot),
                    'C:\\Users\\felix\\myproject\\test.php'
                );
            });
        });
        describe('with path mapping', () => {
            let sources = pathMapping.remote;
            let results = pathMapping.local;

            // unix to unix
            (process.platform !== 'win32' ? it : it.skip)('should map unix uris to unix paths', () => {
                // site
                assert.equal( convertDebuggerPathToClient(sources.unix.site, undef, undef, pathMapping.unixToUnix), results.unix.site );
                // source
                assert.equal( convertDebuggerPathToClient(sources.unix.source, undef, undef, pathMapping.unixToUnix), results.unix.source );
            });

            // unix to windows
            (process.platform === 'win32' ? it : it.skip)('should map unix uris to windows paths', () => {
                // site
                assert.equal( convertDebuggerPathToClient(sources.unix.site, undef, undef, pathMapping.unixServerToWindowsLocal), results.windows.site );
                // source
                assert.equal( convertDebuggerPathToClient(sources.unix.source, undef, undef, pathMapping.unixServerToWindowsLocal), results.windows.source );
            });

            // windows to unix
            (process.platform !== 'win32' ? it : it.skip)('should map windows uris to unix paths', () => {
                // site
                assert.equal( convertDebuggerPathToClient(sources.windows.site, undef, undef, pathMapping.windowsServerToUnixLocal), results.unix.site );
                // source
                assert.equal( convertDebuggerPathToClient(sources.windows.source, undef, undef, pathMapping.windowsServerToUnixLocal), results.unix.source );
            });

            // windows to windows
            (process.platform === 'win32' ? it : it.skip)('should map windows uris to windows paths', () => {
                // site
                assert.equal( convertDebuggerPathToClient(sources.windows.site, undef, undef, pathMapping.windowsToWindows), results.windows.site );
                // source
                assert.equal( convertDebuggerPathToClient(sources.windows.source, undef, undef, pathMapping.windowsToWindows), results.windows.source );
            });
        });
    });
});
