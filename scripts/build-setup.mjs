/*
  Zenlo – trình quản lí hội thoại Zalo

  Builds build/setup/Zenlo-Setup.exe, the installer for everyone: installer/setup/Setup.cs compiled
  by the C# compiler of the .NET Framework that comes with Windows, with Zenlo's built files (dist/)
  inside as resources. About 100 KB, and nothing else to install. Writes its SHA-256 next to it.
  Run "npm run build" first.
*/

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const SOURCE = path.join(ROOT, 'installer', 'setup')
const OUT = path.join(ROOT, 'build', 'setup')
const EXE = path.join(OUT, 'Zenlo-Setup.exe')
const ASSETS = ['zenlo.js', 'zenlo.css', 'zenlo-main.js', 'zenlo-preload.js']
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

for (const name of ASSETS) {
  if (!fs.existsSync(path.join(DIST, name))) throw new Error(`Thiếu dist/${name}. Hãy chạy "npm run build" trước.`)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Phiên bản "${version}" trong package.json không đúng dạng x.y.z.`)

// The compiler that ships with Windows (.NET Framework 4.x)
const windir = process.env.WINDIR || 'C:\\Windows'
const csc = ['Framework64', 'Framework']
  .map((folder) => path.join(windir, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'))
  .find((file) => fs.existsSync(file))
if (!csc) throw new Error('Không tìm thấy trình biên dịch C# của .NET Framework (csc.exe).')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

// The version and the details Windows shows in the file's properties
const buildInfo = path.join(OUT, 'BuildInfo.cs')
fs.writeFileSync(buildInfo, `using System.Reflection;

[assembly: AssemblyTitle("Zenlo Setup")]
[assembly: AssemblyDescription("Cài đặt Zenlo – trình quản lí hội thoại Zalo")]
[assembly: AssemblyProduct("Zenlo")]
[assembly: AssemblyCompany("stephit")]
[assembly: AssemblyCopyright("Copyright (C) 2026 stephit. GPL-3.0-only")]
[assembly: AssemblyVersion("${version}.0")]
[assembly: AssemblyFileVersion("${version}.0")]
[assembly: AssemblyInformationalVersion("${version}")]

namespace Zenlo
{
    internal static class BuildInfo
    {
        public const string Version = "v${version}";
    }
}
`)

execFileSync(csc, [
  '/nologo',
  '/target:exe',
  '/optimize+',
  '/codepage:65001',
  `/out:${EXE}`,
  `/win32manifest:${path.join(SOURCE, 'app.manifest')}`,
  `/win32icon:${path.join(SOURCE, 'zenlo.ico')}`,
  '/reference:System.Web.Extensions.dll',
  ...ASSETS.map((name) => `/resource:${path.join(DIST, name)},${name}`),
  path.join(SOURCE, 'Setup.cs'),
  buildInfo
], { stdio: 'inherit' })
fs.rmSync(buildInfo)

const hash = crypto.createHash('sha256').update(fs.readFileSync(EXE)).digest('hex')
fs.writeFileSync(path.join(OUT, 'SHA256.txt'), `${hash}  Zenlo-Setup.exe\n`)
console.log(`\n${EXE}\n${(fs.statSync(EXE).size / 1024).toFixed(0)} KB · SHA-256 ${hash}`)
