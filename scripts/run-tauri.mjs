import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [, , command = ''] = process.argv
const cargoBin = join(homedir(), '.cargo', 'bin')
const pathSeparator = process.platform === 'win32' ? ';' : ':'
const envPath = process.env.PATH ?? ''

const env = {
  ...process.env,
  PATH: `${cargoBin}${pathSeparator}${envPath}`,
}

const child =
  process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', `pnpm exec tauri ${command}`.trim()], {
        stdio: 'inherit',
        env,
      })
    : spawn('pnpm', ['exec', 'tauri', command].filter(Boolean), {
        stdio: 'inherit',
        env,
      })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
