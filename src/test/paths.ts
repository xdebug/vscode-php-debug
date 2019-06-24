import { isSameUri, convertClientPathToDebugger, convertDebuggerPathToClient } from '../paths'
import * as assert from 'assert'

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
                    'file:///c:/Users/felix/test.php'
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
            })
            // unix to windows
            it('should convert a unix path to a windows URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysite/site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    'file:///c:/Program%20Files/Apache/2.4/htdocs/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('/home/felix/mysource/source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': '/home/felix/mysite',
                        'C:\\Program Files\\MySource': '/home/felix/mysource',
                    }),
                    'file:///c:/Program%20Files/MySource/source.php'
                )
            })
            // windows to unix
            ;(process.platform === 'win32' ? it : it.skip)('should convert a windows path to a unix URI', () => {
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
            })
            ;(process.platform === 'win32' ? it : it.skip)(
                'should convert a windows path with inconsistent casing to a unix URI',
                () => {
                    const localSourceRoot = 'C:\\Users\\felix\\myproject'
                    const serverSourceRoot = '/var/www'
                    assert.equal(
                        convertClientPathToDebugger('c:\\Users\\felix\\myproject\\test.php', {
                            [serverSourceRoot]: localSourceRoot,
                        }),
                        'file:///var/www/test.php'
                    )
                }
            )
            // windows to windows
            ;(process.platform === 'win32' ? it : it.skip)('should convert a windows path to a windows URI', () => {
                // site
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysite\\site.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///c:/Program%20Files/Apache/2.4/htdocs/site.php'
                )
                // source
                assert.equal(
                    convertClientPathToDebugger('C:\\Users\\felix\\mysource\\source.php', {
                        'C:\\Program Files\\Apache\\2.4\\htdocs': 'C:\\Users\\felix\\mysite',
                        'C:\\Program Files\\MySource': 'C:\\Users\\felix\\mysource',
                    }),
                    'file:///c:/Program%20Files/MySource/source.php'
                )
            })
        })
    })
    describe('convertDebuggerPathToClient', () => {
        describe('without source mapping', () => {
            ;(process.platform === 'win32' ? it : it.skip)('should convert a windows URI to a windows path', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///C:/Users/felix/test.php'),
                    'C:\\Users\\felix\\test.php'
                )
            })
            ;(process.platform !== 'win32' ? it : it.skip)('should convert a unix URI to a unix path', () => {
                assert.equal(convertDebuggerPathToClient('file:///home/felix/test.php'), '/home/felix/test.php')
            })
            ;(process.platform === 'win32' ? it : it.skip)('should handle non-unicode special characters', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///d:/arx%20iT/2-R%C3%A9alisation/mmi/V1.0/Web/core/header.php'),
                    'd:\\arx iT\\2-Réalisation\\mmi\\V1.0\\Web\\core\\header.php'
                )
            })
        })
        describe('with source mapping', () => {
            // unix to unix
            ;(process.platform !== 'win32' ? it : it.skip)('should map unix uris to unix paths', () => {
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
            })
            // unix to windows
            ;(process.platform === 'win32' ? it : it.skip)('should map unix uris to windows paths', () => {
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
            })
            // windows to unix
            ;(process.platform !== 'win32' ? it : it.skip)('should map windows uris to unix paths', () => {
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
            ;(process.platform === 'win32' ? it : it.skip)('should map windows uris to windows paths', () => {
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
    })
})
