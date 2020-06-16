import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import iconv from 'iconv-lite'
import cheerio from 'cheerio'
import { VM } from 'vm2'
import { Task, QueueResult } from 'types/amqp'
import { sourceLog } from '../log'
import config from '../config'
import { ErrCode, TaskError, logPrefix, filterObject } from '../utils'

const decodeData = (response: AxiosResponse, task: Task): string => {
  const log = logPrefix(sourceLog, task.taskId)
  if (task.encoding) {
    log.debug('set encoding:', task.encoding)
    return iconv.decode(Buffer.from(response.data), task.encoding)
  }
  const contentType: string = response.headers['content-type']
  if (contentType) {
    const matchRes = contentType.match(/(?<=charset=)\S+/)
    if (matchRes) {
      const encoding = matchRes[0]
      log.info('encoding detected:', encoding)
      try {
        return iconv.decode(Buffer.from(response.data), encoding)
      } catch (error) {
        log.warn(`cannot decode response with ${encoding} (content-type: ${contentType})`, error)
      }
    }
  } else {
    log.warn(`no content-type in response headers`)
  }
  return iconv.decode(Buffer.from(response.data), 'utf-8')
}

const runTask = async (task: Task): Promise<QueueResult> => {
  const startTime = Date.now()
  const log = logPrefix(sourceLog, task.taskId)
  log.info('---------- RUN TASK ----------')
  try {
    let retryRemain = config.source.retries
    const fetchData = async (): Promise<AxiosResponse> => {
      try {
        const timeout = (task.timeout || config.source.defaultLoadTimeout) * 1000
        const requestParams: AxiosRequestConfig = {
          url: task.url,
          method: task.method || 'GET',
          headers: {},
          responseType: 'arraybuffer',
          validateStatus: () => true,
          timeout,
        }
        if (config.source.userAgent) {
          Object.assign(requestParams.headers, {
            'user-agent': config.source.userAgent,
          })
        }
        if (task.params) {
          log.debug('request url params:', task.params)
          requestParams.params = task.params
        }
        if (task.data) {
          log.debug('request data:', task.data)
          requestParams.data =
            typeof task.data === 'object' ? new URLSearchParams(task.data).toString() : task.data
        }
        if (task.headers) {
          log.debug('request headers:', task.headers)
          Object.assign(requestParams.headers, task.headers)
        }
        if (task.cookies) {
          log.debug('request cookies:', task.cookies)
          const cookieStr = task.cookies.map((c) => `${c.name.trim()}=${c.value.trim()}`).join('; ')
          Object.assign(requestParams.headers, {
            cookie: cookieStr,
          })
        }
        if (task.auth) {
          log.debug('set authenticate')
          requestParams.auth = task.auth
        }
        log.debug('load timeout:', timeout)
        log.info('fetch html data...')
        const result = await axios(requestParams)
        if (!(result.status >= 200 && result.status < 300)) {
          throw new TaskError(`page status code is ${result.status}`)
        }
        return result
      } catch (error) {
        log.error('fetch error:', error.message)
        if (retryRemain > 0 && !(error instanceof TaskError)) {
          log.info(`retrying... (${retryRemain} times left)`)
          retryRemain--
          return fetchData()
        }
        throw error
      }
    }

    const resultData: QueueResult = {
      startTime,
      endTime: Date.now(),
    }

    let response: AxiosResponse
    try {
      response = await fetchData()
    } catch (error) {
      log.error('failed to fetch:', error.message)
      return {
        startTime,
        endTime: Date.now(),
        errorCode: ErrCode.PageLoadError,
        errorMsg: error.message,
      }
    }

    const respHeaders = response.headers
    log.debug('response headers:', respHeaders)
    if (task.requireHeaders) {
      if (respHeaders['set-cookie'] && Array.isArray(respHeaders['set-cookie'])) {
        respHeaders['set-cookie'] = respHeaders['set-cookie'].join('; ')
      }
      resultData.headers = filterObject(respHeaders, task.requireHeaders)
    }

    const dom = cheerio.load(decodeData(response, task))
    log.info('dom loaded')

    const vm = new VM({
      sandbox: { $: dom },
      timeout: 1000,
      eval: false,
      fixAsync: true,
    })

    try {
      log.info('execute user script...')
      const data = vm.run(task.script)
      log.info('script execution completed')
      log.debug('script execution result:', data)
      resultData.data = data
    } catch (error) {
      log.error('script execution failed:', error.message)
      return {
        startTime,
        endTime: Date.now(),
        errorCode: ErrCode.ScriptError,
        errorMsg: error.message,
      }
    }

    resultData.endTime = Date.now()
    log.info('spend time:', resultData.endTime - startTime)
    return resultData
  } catch (error) {
    log.error('task execution error:', error)
    return {
      startTime,
      endTime: Date.now(),
      errorCode: ErrCode.SourceError,
      errorMsg: error.message,
    }
  }
}

export default runTask
