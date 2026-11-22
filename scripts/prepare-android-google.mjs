import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises'

const app = new URL('../src-tauri/gen/android/app/', import.meta.url)
const kotlin = new URL('src/main/java/com/kspress/thread/', app)
await mkdir(kotlin, { recursive: true })
await copyFile(
  new URL('../src-tauri/android/ThreadGooglePlugin.kt', import.meta.url),
  new URL('ThreadGooglePlugin.kt', kotlin),
)

const gradle = new URL('build.gradle.kts', app)
const dependency = 'com.google.android.gms:play-services-auth:21.3.0'
if (!(await readFile(gradle, 'utf8')).includes(dependency)) {
  await appendFile(gradle, `\ndependencies { implementation("${dependency}") }\n`)
}
