import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'dist')
const allowedExtensions = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.txt', '.xml', '.webmanifest', '.svg'])
const forbiddenPatterns = [
  /sb_secret_[A-Za-z0-9_-]{16,}/i,
  /"role"\s*:\s*"service_role"/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /DATABASE_PASSWORD/i,
  /HOMECOIN_TEST_USER_[ABC]_PASSWORD/i,
  /HOMECOIN_TEST_USER_[ABC]_EMAIL/i,
  /\.env\.local/i,
  /\.env\.test\.local/i,
]

function walk(directory, results = []) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      walk(fullPath, results)
      continue
    }
    results.push(fullPath)
  }
  return results
}

if (!existsSync(root)) {
  console.error('dist/ not found. Run pnpm build:web before security:scan-build.')
  process.exit(1)
}

const files = walk(root).filter((file) => allowedExtensions.has(file.slice(file.lastIndexOf('.')).toLowerCase()))
const findings = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) findings.push({ file, pattern: String(pattern) })
  }
}

if (findings.length) {
  console.error('Sensitive material detected in dist/:')
  for (const finding of findings) {
    console.error(`- ${finding.file} matched ${finding.pattern}`)
  }
  process.exit(1)
}

console.log(`Security scan passed for ${files.length} text files in dist/.`)
