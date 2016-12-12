
import {isSameUri, convertClientPathToDebugger, convertDebuggerPathToClient} from '../paths';
import * as assert from 'assert';

describe('paths', () => {
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
    });
    describe('convertDebuggerPathToClient', () => {
        describe('without source mapping', () => {
            (process.platform === 'win32' ? it : it.skip)('should convert a windows URI to a windows path', () => {
                assert.equal(convertDebuggerPathToClient('file:///C:/Users/felix/test.php'), 'C:\\Users\\felix\\test.php');
            });
            (process.platform !== 'win32' ? it : it.skip)('should convert a unix URI to a unix path', () => {
                assert.equal(convertDebuggerPathToClient('file:///home/felix/test.php'), '/home/felix/test.php');
            });
            (process.platform === 'win32' ? it : it.skip)('should handle non-unicode special characters', () => {
                assert.equal(
                    convertDebuggerPathToClient('file:///d:/arx%20iT/2-R%C3%A9alisation/mmi/V1.0/Web/core/header.php'),
                    'file:///d:/arx iT/2-Réalisation/mmi/V1.0/Web/core/header.php'
                );
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
    });
});
