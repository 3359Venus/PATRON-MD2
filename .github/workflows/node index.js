const { spawnSync, spawn } = require('child_process')
const { existsSync, readFileSync, writeFileSync } = require('fs')
const path = require('path')

const SESSION_ID = 'updateThis' // Edit this line only, don't remove ' <- this symbol

// Constants
const APP_DIR = 'PATRON-MD' // Standardized directory name
const MAX_NODE_RESTARTS = 5
const NODE_RESTART_WINDOW = 30000 // 30 seconds
const MAX_PM2_RESTARTS = 5

let nodeRestartCount = 0
let lastRestartTime = Date.now()

function startNode() {
  const child = spawn('node', ['index.js'], {
    cwd: APP_DIR,
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    if (code !== 0) {
      const currentTime = Date.now()
      if (currentTime - lastRestartTime > NODE_RESTART_WINDOW) {
        nodeRestartCount = 0
      }
      lastRestartTime = currentTime
      nodeRestartCount++

      if (nodeRestartCount > MAX_NODE_RESTARTS) {
        console.error('Node.js is restarting too frequently. Stopping...')
        process.exit(1)
      }

      console.log(`Node.js exited with code ${code}. Restarting... (Attempt ${nodeRestartCount}/${MAX_NODE_RESTARTS})`)
      startNode()
    }
  })
}

function startPm2() {
  const pm2 = spawn('yarn', [
    'pm2',
    'start',
    'index.js',
    '--name',
    'PATRON-MD',
    '--attach',
  ], {
    cwd: APP_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let restartCount = 0

  pm2.on('exit', (code) => {
    if (code !== 0) {
      console.log('PM2 process exited. Falling back to node...')
      startNode()
    }
  })

  pm2.on('error', (error) => {
    console.error(`PM2 error: ${error.message}`)
    startNode()
  })

  if (pm2.stderr) {
    pm2.stderr.on('data', (data) => {
      const output = data.toString()
      console.error(output)
      if (output.includes('restart')) {
        restartCount++
        if (restartCount > MAX_PM2_RESTARTS) {
          console.error('PM2 restart limit reached. Falling back to node...')
          spawnSync('yarn', ['pm2', 'delete', 'PATRON-MD'], {
            cwd: APP_DIR,
            stdio: 'inherit',
          })
          startNode()
        }
      }
    })
  }

  if (pm2.stdout) {
    pm2.stdout.on('data', (data) => {
      const output = data.toString()
      console.log(output)
      if (output.includes('Connecting')) restartCount = 0
    })
  }
}

function installDependencies() {
  console.log('Installing dependencies...')
  const installResult = spawnSync(
    'yarn',
    ['install', '--force', '--non-interactive', '--network-concurrency', '3'],
    {
      cwd: APP_DIR,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    }
  )

  if (installResult.error || installResult.status !== 0) {
    console.error(`Failed to install dependencies: ${installResult.error?.message || 'Unknown error'}`)
    process.exit(1)
  }
}

function checkDependencies() {
  const packageJsonPath = path.join(APP_DIR, 'package.json')
  if (!existsSync(packageJsonPath)) {
    console.error('package.json not found!')
    process.exit(1)
  }

  const result = spawnSync('yarn', ['check', '--verify-tree'], {
    cwd: APP_DIR,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.log('Dependencies are missing or broken. Reinstalling...')
    installDependencies()
  }
}

function updateConfigFile() {
  const configPath = path.join(APP_DIR, 'config.js')
  if (!existsSync(configPath)) {
    console.error('config.js not found!')
    process.exit(1)
  }

  try {
    let configData = readFileSync(configPath, 'utf-8')
    const updatedConfig = configData.replace(
      /SESSION_ID:\s*process\.env\.SESSION_ID\s*\|\|\s*["'].*?["']/, 
      `SESSION_ID: process.env.SESSION_ID || "${SESSION_ID}"`
    )
    writeFileSync(configPath, updatedConfig)
    console.log('✅ config.js updated with SESSION_ID')
  } catch (error) {
    console.error(`Failed to update config: ${error.message}`)
    process.exit(1)
  }
}

function cloneRepository() {
  try {
    console.log('Cloning repository...')
    const cloneResult = spawnSync(
      'git',
      ['clone', 'https://github.com/Itzpatron/PATRON-MD2.git', APP_DIR],
      { stdio: 'inherit' }
    )

    if (cloneResult.error) {
      throw new Error(`Failed to clone: ${cloneResult.error.message}`)
    }

    if (cloneResult.status !== 0) {
      throw new Error(`Clone failed with status ${cloneResult.status}`)
    }
  } catch (error) {
    console.error(`Repository clone failed: ${error.message}`)
    process.exit(1)
  }
}

// Main execution
try {
  if (!existsSync(APP_DIR)) {
    cloneRepository()
    installDependencies()
    updateConfigFile()
  } else {
    checkDependencies()
    updateConfigFile()
  }

  startPm2()
} catch (error) {
  console.error(`Boot failed: ${error.message}`)
  process.exit(1)
}
