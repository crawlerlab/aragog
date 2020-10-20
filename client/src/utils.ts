import { AmqpConn, Cookie } from 'types/amqp'
import { SendData } from './amqp'

export const checkTaskInput = (data: SendData & { id: string }): void => {
  const allKeys: Array<keyof typeof data> = [
    'id',
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
    if (['id', 'url', 'script'].includes(key)) {
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

export const checkConnectParam = (connParam: AmqpConn & { appName: string }): void => {
  const allKeys: Array<keyof typeof connParam> = ['hostname', 'username', 'password', 'appName']
  allKeys.forEach((key) => {
    if (!connParam[key]) {
      throw new Error(`${key} is required`)
    }
    if (typeof connParam[key] !== 'string') {
      throw new Error(`${key} must be of type string`)
    }
  })
}
