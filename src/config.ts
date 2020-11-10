import path from 'path'
import JSON5 from 'json5'
import fse from 'fs-extra'
import { merge } from 'lodash'
import type { AmqpConn } from 'types/amqp'
import type { QueueParam } from './amqp'

export const dataDir = path.resolve(__dirname, '../data')
fse.ensureDirSync(dataDir)

const CFG_FILE_PATH = path.join(dataDir, 'config.json5')

interface LogCfg {
  maxSize: number
  backups: number
}

export interface Config {
  amqp: {
    server: AmqpConn
    headlessQueue: QueueParam
    sourceQueue: QueueParam
    messageTimeout: number
  }
  log: {
    debugMode: boolean
    amqp: LogCfg
    error: LogCfg
    headless: LogCfg
    source: LogCfg
  }
  headless: {
    headless: boolean
    ignoreHTTPSErrors: boolean
    browserCloseTimeout: number
    defaultLoadTimeout: number
    retries: number
    userAgent: string
  }
  source: {
    defaultLoadTimeout: number
    retries: number
    userAgent: string
  }
}

const defaultConfig: Config = {
  amqp: {
    server: {
      hostname: 'localhost',
      username: 'guest',
      password: 'guest',
    },
    headlessQueue: {
      queue: 'headless',
      exchange: 'aragog_exchange',
      prefetch: 5,
    },
    sourceQueue: {
      queue: 'source',
      exchange: 'aragog_exchange',
      prefetch: 5,
    },
    messageTimeout: 5 * 60,
  },
  log: {
    debugMode: false,
    amqp: {
      maxSize: 5120,
      backups: 5,
    },
    error: {
      maxSize: 5120,
      backups: 5,
    },
    headless: {
      maxSize: 5120,
      backups: 5,
    },
    source: {
      maxSize: 5120,
      backups: 5,
    },
  },
  headless: {
    headless: true,
    ignoreHTTPSErrors: false,
    browserCloseTimeout: 5 * 60,
    defaultLoadTimeout: 60,
    retries: 2,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36',
  },
  source: {
    defaultLoadTimeout: 30,
    retries: 2,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36',
  },
}

if (!fse.pathExistsSync(CFG_FILE_PATH)) {
  fse.writeFileSync(CFG_FILE_PATH, JSON5.stringify(defaultConfig, undefined, 2))
}

const userConfig: Config = JSON5.parse(fse.readFileSync(CFG_FILE_PATH).toString())
const config = merge<Config, Config>(defaultConfig, userConfig)

export default config
