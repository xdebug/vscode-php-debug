const gulp = require('gulp');
const typescript = require('gulp-typescript');
const sourcemaps = require('gulp-sourcemaps');
const babel = require('gulp-babel');
const es2015Node5 = require('babel-preset-es2015-node5');
const fileUrl = require('file-url');

const tsConfig = typescript.createProject('tsconfig.json', {typescript: require('typescript')});

gulp.task('compile', () =>
    tsConfig.src()
        .pipe(sourcemaps.init())
        .pipe(typescript(tsConfig)).js
        .pipe(babel({presets: [es2015Node5]}))
        .pipe(sourcemaps.write('.', {includeContent: false, sourceRoot: fileUrl(__dirname + '/src')}))
        .pipe(gulp.dest('out'))
);

gulp.task('watch', () =>
    gulp.watch(['src/**/*.ts', 'src/**/*.d.ts'], ['compile'])
);
