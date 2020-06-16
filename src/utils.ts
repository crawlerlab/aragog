import { Task, Cookie } from 'types/amqp'
import type { Logger } from 'log4js'

export enum ErrCode {
  InvalidParams = 4000,
  PageLoadError,
  ScriptError,
  HeadlessError = 5000,
  SourceError = 5010,
}

export class TaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskError'
  }
}

export const checkTaskInput = (data: Task): void => {
  const allKeys: Array<keyof typeof data> = [
    'url',
    'script',
    'disableImage',
    'encoding',
    'method',
    'auth',
    'data',
    'params',
    'cookies',
    'headers',
    'requireHeaders',
    'timeout',
  ]
  allKeys.forEach((key) => {
    if (['url', 'script'].includes(key)) {
      if (!data[key]) {
        throw new Error(`${key} is required`)
      }
      if (typeof data[key] !== 'string') {
        throw new Error(`${key} must be of type string`)
      }
    }
    if (data[key] !== undefined) {
      if (key === 'disableImage' && typeof data[key] !== 'boolean') {
        throw new Error(`${key} must be of type boolean`)
      }
      if (key === 'encoding' && typeof data[key] !== 'string') {
        throw new Error(`${key} must be of type string`)
      }
      if (key === 'method' && data[key] !== 'GET' && data[key] !== 'POST') {
        throw new Error(`${key} should be GET or POST`)
      }
      if (
        key === 'auth' &&
        !(
          typeof data[key] === 'object' &&
          typeof data[key]?.username === 'string' &&
          typeof data[key]?.password === 'string'
        )
      ) {
        throw new Error(`${key} should contain username and password of string type`)
      }
      if (key === 'data' && typeof data[key] !== 'object' && typeof data[key] !== 'string') {
        throw new Error(`${key} must be of type object or string`)
      }
      if (['params', 'headers'].includes(key) && typeof data[key] !== 'object') {
        throw new Error(`${key} must be of type object`)
      }
      if (key === 'requireHeaders' && !Array.isArray(data[key]) && typeof data[key] !== 'boolean') {
        throw new Error(`${key} must be of type boolean or array`)
      }
      if (key === 'timeout' && typeof data[key] !== 'number') {
        throw new Error(`${key} must be of type number`)
      }
      if (key === 'cookies') {
        if (!Array.isArray(data.cookies)) {
          throw new Error('cookies must be of type array')
        }
        const fieldTypes = {
          name: 'string',
          value: 'string',
          domain: 'string',
          path: 'string',
          expires: 'number',
          httpOnly: 'boolean',
          secure: 'boolean',
          sameSite: 'string',
        }
        data.cookies.forEach((cookie: Cookie) => {
          if (!cookie.name || !cookie.value) {
            throw new Error(`cookies.name and cookies.value is required`)
          }
          Object.entries(fieldTypes).forEach(([k, type]) => {
            const cookieKey = k as keyof Cookie
            /* eslint-disable-next-line valid-typeof */
            if (cookie[cookieKey] !== undefined && typeof cookie[cookieKey] !== type) {
              throw new Error(`cookies.${k} must be of type ${type}`)
            }
          })
        })
      }
    }
  })
}

export const logPrefix = (logger: Logger, tag: string): Logger =>
  new Proxy(logger, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (obj, prop: 'debug' | 'info' | 'warn' | 'error') => (...args: any[]): void =>
      obj[prop](`[${tag}]`, ...args),
  })

export const filterObject = (
  headers: { [key: string]: string },
  requireHeaders: boolean | string[]
): { [key: string]: string } => {
  return (
    Object.entries(headers)
      .filter(([key]) => {
        if (Array.isArray(requireHeaders)) {
          return requireHeaders.map((d) => d.toLowerCase()).includes(key)
        }
        return requireHeaders
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((obj: any, [key, value]) => {
        // eslint-disable-next-line no-param-reassign
        obj[key] = value
        return obj
      }, {})
  )
}
