import { isSameUri, convertClientPathToDebugger, convertDebuggerPathToClient, isPositiveMatchInGlobs } from '../paths'
import * as assert from 'assert'
import { describe, it } from 'mocha'

describe('paths', () => {
    describe('isSameUri', () => {
        it('should compare to URIs', () => {
            assert.strictEqual(isSameUri('file:///var/www/test.php', 'file:///var/www/test.php'), true)
            assert.strictEqual(isSameUri('file:///var/www/test.php', 'file:///var/www/test2.php'), false)
        })
        it('should compare windows paths case-insensitive', () => {
            assert.strictEqual(
                isSameUri(
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/test.php',
                    'file:///c:/Program%20Files/Apache/2.4/htdocs/test.php'
                ),
                true
            )
            assert.strictEqual(
                isSameUri(
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/test.php',
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/test2.php'
                ),
                false
            )
        })
    })
    describe('convertClientPathToDebugger', () => {
        describe('without source mapping', () => {
            it('should convert a windows path to a URI', () => {
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\test.php'),
                    'file:///C:/Users/felix/test.php'
                )
            })
            it('should convert a unix path to a URI', () => {
                assert.equal(convertClientPathToDebugger('/home/felix/test.php'), 'file:///home/felix/test.php')
            })
        })
        describe('with source mapping', () => {
            // unix to unix
            it('should convert a unix path to a unix URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysite/site.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app': '/home/felix/mysource',
                    }),
                    'file:///var/www/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysource/source.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app': '/home/felix/mysource',
                    }),
                    'file:///app/source.php'
                )
                // longest prefix matching for server paths
                assert.strictEqual(
                    convertClientPathToDebugger('/home/felix/mysource/subdir/source.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app/subdir1': '/home/felix/mysource/subdir',
                        '/app': '/home/felix/mysource',
                    }),
                    'file:///app/subdir1/source.php'
                )
            })
            // unix to windows
            it('should convert a unix path to a windows URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysite/site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysource/source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    'file:///C:/Program%20Files/MySource/source.php'
                )
            })
            // windows to unix
            it('should convert a windows path to a unix URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysite\\site.php', {
                        '/var/www': 'C:\\Users\\felix\\mysite',
                        '/app': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///var/www/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysource\\source.php', {
                        '/var/www': 'C:\\Users\\felix\\mysite',
                        '/app': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///app/source.php'
                )
                // only driv eletter
                assert.equal(
                    convertClientPathToDebugger('C:\\source.php', {
                        '/var/www': 'C:',
                    }),
                    'file:///var/www/source.php'
                )
                // only driv eletter
                assert.equal(
                    convertClientPathToDebugger('C:\\app\\source.php', {
                        '/': 'C:',
                    }),
                    'file:///app/source.php'
                )
                // drive letter with slash
                assert.equal(
                    convertClientPathToDebugger('C:\\app\\source.php', {
                        '/var/www': 'C:/',
                    }),
                    'file:///var/www/app/source.php'
                )
                // drive letter with slash
                assert.equal(
                    convertClientPathToDebugger('C:\\app\\source.php', {
                        '/': 'C:/',
                    }),
                    'file:///app/source.php'
                )
            })
            it('should convert a windows path with inconsistent casing to a unix URI', () => {
                const localSourceRoot = 'C:\\Users\\felix\\myproject'
                const serverSourceRoot = '/var/www'
                assert.equal(
                    convertClientPathToDebugger('c:\\Users\\felix\\myproject\\test.php', {
                        [serverSourceRoot]: localSourceRoot,
                    }),
                    'file:///var/www/test.php'
                )
            })
            // windows to windows
            it('should convert a windows path to a windows URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysite\\site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///C:/Program%20Files/Apache/2.4/htdocs/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysource\\source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///C:/Program%20Files/MySource/source.php'
                )
            })
        })
        describe('exact file mappings', () => {
            it('should map exact unix path', () => {
                assert.equal(
                    convertClientPathToDebugger('/var/path/file.php', {
                        '/var/path2/file2.php': '/var/path/file.php',
                    }),
                    'file:///var/path2/file2.php'
                )
            })
            it('should map exact windows path', () => {
                assert.equal(
                    convertClientPathToDebugger('C:\\var\\path\\file.php', {
                        'C:\\var\\path2\\file2.php': 'C:\\var\\path\\file.php',
                    }),
                    'file:///C:/var/path2/file2.php'
                )
            })
        })
        describe('relative paths', () => {
            it('should resolve relative path posix', () => {
                assert.equal(convertClientPathToDebugger('/var/www/foo/../bar'), 'file:///var/www/bar')
            })
            it('should resolve relative path maps posix', () => {
                assert.equal(
                    convertClientPathToDebugger('/work/foo/test.php', {
                        '/var/www/html/bar': '/work/project/folder/../../foo',
                    }),
                    'file:///var/www/html/bar/test.php'
                )
            })
            it('should resolve relative path win32', () => {
                assert.equal(convertClientPathToDebugger('C:\\var\\www\\foo\\..\\bar'), 'file:///C:/var/www/bar')
            })
            it('should resolve relative path maps win32 to posix', () => {
                assert.equal(
                    convertClientPathToDebugger('C:\\work\\foo\\test.php', {
                        '/var/www/html/bar': 'C:\\work\\project\\folder\\..\\..\\foo',
                    }),
                    'file:///var/www/html/bar/test.php'
                )
            })
            it('should resolve relative path maps win32 to win32', () => {
                assert.equal(
                    convertClientPathToDebugger('C:\\work\\foo\\test.php', {
                        'C:\\var\\www\\html\\bar': 'C:\\work\\project\\folder\\..\\..\\foo',
                    }),
                    'file:///C:/var/www/html/bar/test.php'
                )
            })
        })
    })
    describe('convertDebuggerPathToClient', () => {
        describe('without source mapping', () => {
            it('should convert a windows URI to a windows path', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Users/felix/test.php'),
                    'C:\\Users\\felix\\test.php'
                )
            })
            it('should convert a unix URI to a unix path', () => {
                assert.equal(convertDebuggerPathToClient('file:///home/felix/test.php'), '/home/felix/test.php')
            })
            it('should handle non-unicode special characters', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///d:/arx%20iT/2-R%C3%A9alisation/mmi/V1.0/Web/core/header.php'),
                    'd:\\arx iT\\2-Réalisation\\mmi\\V1.0\\Web\\core\\header.php'
                )
            })
        })
        describe('with source mapping', () => {
            // unix to unix
            it('should map unix uris to unix paths', () => {
                // site
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/site.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app': '/home/felix/mysource',
                    }),
                    '/home/felix/mysite/site.php'
                )
                // source
                assert.equal(
                    convertDebuggerPathToClient('file:///app/source.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app': '/home/felix/mysource',
                    }),
                    '/home/felix/mysource/source.php'
                )
                // longest prefix matching for local paths
                assert.strictEqual(
                    convertDebuggerPathToClient('file:///app/subdir/source.php', {
                        '/var/www': '/home/felix/mysite',
                        '/app/subdir': '/home/felix/mysource/subdir1',
                        '/app': '/home/felix/mysource',
                    }),
                    '/home/felix/mysource/subdir1/source.php'
                )
            })
            // unix to windows
            it('should map unix uris to windows paths', () => {
                // site
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/site.php', {
                        '/var/www': 'C:\\Users\\felix\\mysite',
                        '/app': 'C:\\Users\\felix\\mysource',
                    }),
                    'C:\\Users\\felix\\mysite\\site.php'
                )
                // source
                assert.equal(
                    convertDebuggerPathToClient('file:///app/source.php', {
                        '/var/www': 'C:\\Users\\felix\\mysite',
                        '/app': 'C:\\Users\\felix\\mysource',
                    }),
                    'C:\\Users\\felix\\mysource\\source.php'
                )
                // only drive letter
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/source.php', {
                        '/var/www': 'C:',
                    }),
                    'C:\\source.php'
                )
                // only drive letter
                assert.equal(
                    convertDebuggerPathToClient('file:///app/source.php', {
                        '/': 'C:',
                    }),
                    'C:\\app\\source.php'
                )
                // drive letter with slash
                assert.equal(
                    convertDebuggerPathToClient('file:///var/www/source.php', {
                        '/var': 'C:/',
                    }),
                    'C:\\www\\source.php'
                )
                // drive letter with slash
                assert.equal(
                    convertDebuggerPathToClient('file:///app/source.php', {
                        '/': 'C:/',
                    }),
                    'C:\\app\\source.php'
                )
            })
            // windows to unix
            it('should map windows uris to unix paths', () => {
                // dir/site
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/Apache/2.4/htdocs/dir/site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    '/home/felix/mysite/dir/site.php'
                )
                // site
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/Apache/2.4/htdocs/site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    '/home/felix/mysite/site.php'
                )
                // source
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/MySource/source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    '/home/felix/mysource/source.php'
                )
                // multi level source
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/MySource/src/app/source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    '/home/felix/mysource/src/app/source.php'
                )
            })
            // windows to windows
            it('should map windows uris to windows paths', () => {
                // site
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/Apache/2.4/htdocs/site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'C:\\Users\\felix\\mysite\\site.php'
                )
                // source
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Program%20Files/MySource/source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'C:\\Users\\felix\\mysource\\source.php'
                )
            })
        })
        describe('exact file mappings', () => {
            it('should map exact unix path', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///var/path2/file2.php', {
                        '/var/path2/file2.php': '/var/path/file.php',
                    }),
                    '/var/path/file.php'
                )
            })
            it('should map exact windows path', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/var/path2/file2.php', {
                        'C:\\var\\path2\\file2.php': 'C:\\var\\path\\file.php',
                    }),
                    'C:\\var\\path\\file.php'
                )
            })
        })
    })
    describe('sshfs', () => {
        it('should map sshfs to remote unix', () => {
            assert.equal(
                convertClientPathToDebugger('ssh://host/path/file.php', {
                    '/root/path': 'ssh://host/path/',
                }),
                'file:///root/path/file.php'
            )
        })
        it('should map remote unix to sshfs', () => {
            assert.equal(
                convertDebuggerPathToClient('file:///root/path/file.php', {
                    '/root/path': 'ssh://host/path/',
                }),
                'ssh://host/path/file.php'
            )
        })
        it('should map sshfs to remote unix relative', () => {
            assert.equal(
                convertClientPathToDebugger('ssh://host/path/file.php', {
                    '/root/path': 'ssh://host/test/../path/',
                }),
                'file:///root/path/file.php'
            )
        })
        it('should map remote unix to sshfs relative', () => {
            assert.equal(
                convertDebuggerPathToClient('file:///root/path/file.php', {
                    '/root/path': 'ssh://host/test/../path/',
                }),
                'ssh://host/path/file.php'
            )
        })
    })
    describe('UNC', () => {
        it('should convert UNC to url', () => {
            assert.equal(convertClientPathToDebugger('\\\\DARKPAD\\smb\\test1.php', {}), 'file://darkpad/smb/test1.php')
        })
        it('should convert url to UNC', () => {
            assert.equal(convertDebuggerPathToClient('file://DARKPAD/SMB/test2.php', {}), '\\\\darkpad\\SMB\\test2.php')
        })
    })
    describe('UNC mapping', () => {
        it('should convert UNC to mapped url', () => {
            assert.equal(
                convertClientPathToDebugger('\\\\DARKPAD\\smb\\test1.php', {
                    '/var/test': '\\\\DARKPAD\\smb',
                }),
                'file:///var/test/test1.php'
            )
        })
        it('should convert url to mapped UNC', () => {
            assert.equal(
                convertDebuggerPathToClient('file:///var/test/test2.php', {
                    '/var/test': '\\\\DARKPAD\\smb',
                }),
                '\\\\darkpad\\smb\\test2.php'
            )
        })
    })
    describe('Phar', () => {
        it('should map win32 Phar client to debugger', () => {
            assert.equal(
                convertClientPathToDebugger('C:\\otherfolder\\internal\\file.php', {
                    'phar://C:/folder/file.phar': 'C:\\otherfolder',
                }),
                'phar://C:/folder/file.phar/internal/file.php'
            )
        })
        it('should map win32 Phar debugger to debugger', () => {
            assert.equal(
                convertDebuggerPathToClient('phar://C:/folder/file.phar/internal/file.php', {
                    'phar://C:/folder/file.phar': 'C:\\otherfolder',
                }),
                'C:\\otherfolder\\internal\\file.php'
            )
        })
        it('should map posix Phar client to debugger', () => {
            assert.equal(
                convertClientPathToDebugger('/otherfolder/internal/file.php', {
                    'phar:///folder/file.phar': '/otherfolder',
                }),
                'phar:///folder/file.phar/internal/file.php'
            )
        })
        it('should map posix Phar debugger to debugger', () => {
            assert.equal(
                convertDebuggerPathToClient('phar:///folder/file.phar/internal/file.php', {
                    'phar:///folder/file.phar': '/otherfolder',
                }),
                '/otherfolder/internal/file.php'
            )
        })
    })
    describe('isPositiveMatchInGlobs', () => {
        it('should not match empty globs', () => {
            assert.equal(isPositiveMatchInGlobs('/test/test.php', []), false)
        })
        it('should match positive globs', () => {
            assert.equal(isPositiveMatchInGlobs('/test/test.php', ['**/test/**']), true)
        })
        it('should not match positive globs', () => {
            assert.equal(isPositiveMatchInGlobs('/test/test.php', ['**/not_test/**']), false)
        })
        it('should match negative globs', () => {
            assert.equal(isPositiveMatchInGlobs('/test/test.php', ['!**/test.php', '**/test/**']), false)
        })
        it('should not match negative globs', () => {
            assert.equal(isPositiveMatchInGlobs('/test/test.php', ['!**/not_test/test.php', '**/test/**']), true)
        })
    })
})
