import path from 'path'
import log4js from 'log4js'
import config, { dataDir } from './config'

const LOG_DIR = path.join(dataDir, 'logs')

const logConfig = config.log
const isTestEnv = process.env.NODE_ENV === 'test'
const logLevel = logConfig.debugMode || isTestEnv ? 'debug' : 'info'
const consoleFilter = (type: string): boolean => (isTestEnv ? type !== 'console' : true)

log4js.configure({
  appenders: {
    console: {
      type: 'stdout',
    },
    amqpFile: {
      type: 'file',
      filename: path.join(LOG_DIR, 'amqp.log'),
      maxLogSize: logConfig.amqp.maxSize * 1024,
      backups: logConfig.amqp.backups,
      keepFileExt: true,
    },
    errorFile: {
      type: 'file',
      filename: path.join(LOG_DIR, 'error.log'),
      maxLogSize: logConfig.error.maxSize * 1024,
      backups: logConfig.error.backups,
      keepFileExt: true,
    },
    headlessFile: {
      type: 'file',
      filename: path.join(LOG_DIR, 'headless.log'),
      maxLogSize: logConfig.headless.maxSize * 1024,
      backups: logConfig.headless.backups,
      keepFileExt: true,
    },
    sourceFile: {
      type: 'file',
      filename: path.join(LOG_DIR, 'source.log'),
      maxLogSize: logConfig.source.maxSize * 1024,
      backups: logConfig.source.backups,
      keepFileExt: true,
    },
    error: {
      type: 'logLevelFilter',
      appender: 'errorFile',
      level: 'error',
    },
  },
  categories: {
    default: {
      appenders: ['console'],
      level: logLevel,
    },
    amqp: {
      appenders: ['console', 'error', 'amqpFile'].filter(consoleFilter),
      level: logLevel,
    },
    headless: {
      appenders: ['console', 'error', 'headlessFile'].filter(consoleFilter),
      level: logLevel,
    },
    source: {
      appenders: ['console', 'error', 'sourceFile'].filter(consoleFilter),
      level: logLevel,
    },
  },
})

const amqpLog = log4js.getLogger('amqp')
const headlessLog = log4js.getLogger('headless')
const sourceLog = log4js.getLogger('source')

export { amqpLog, headlessLog, sourceLog }
