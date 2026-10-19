/*
  Zenlo – trình quản lí hội thoại Zalo
  Builds the Zalo PC installer and Zenlo's assets into build/pc.
*/

const { src, dest, watch, series } = require('gulp')
const mergeStream = require('merge-stream')
const sass = require('sass')
const gulpSass = require('gulp-sass')(sass)
const minify = require('gulp-minify')
const rename = require('gulp-rename')
const del = require('del')

const PC_PATH = 'src/pc'
const BUILD_PATH = 'build/pc'

const isDevelopment = process.env.NODE_ENV === 'development'

const minifyOptions = {
  ext: {
    min: '.min.js'
  },
  ignoreFiles: ['.min.js'],
  noSource: true,
  compress: {
    global_defs: {
      DEBUG: isDevelopment
    }
  },
  output: {
    beautify: isDevelopment
  }
}

const clean = () => del(BUILD_PATH)

const buildPC = () => {
  return mergeStream(
    // Installer (Node.js), copied as is
    src([
      `${PC_PATH}/**/*`,
      `!${PC_PATH}/assets/**`
    ]).pipe(dest(BUILD_PATH)),

    // Zenlo scripts that run inside Zalo
    src(`${PC_PATH}/assets/js/*.js`)
      .pipe(minify(minifyOptions))
      .pipe(dest(`${BUILD_PATH}/assets/js`)),

    // Zenlo styles
    src(`${PC_PATH}/assets/scss/*.scss`)
      .pipe(gulpSass({ outputStyle: 'compressed' }).on('error', gulpSass.logError))
      .pipe(rename({ suffix: '.min' }))
      .pipe(dest(`${BUILD_PATH}/assets/css`))
  )
}

const build = series(clean, buildPC)

// Watch rebuilds overwrite files in place instead of cleaning first, so a Zalo installed in
// dev mode (linked to build/pc/assets) never sees the folder disappear
const dev = series(build, () => {
  watch(`${PC_PATH}/**/*`, buildPC)
})

exports.build = build
exports.dev = dev
