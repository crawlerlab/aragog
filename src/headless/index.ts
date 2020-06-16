import path from 'path'
import querystring from 'querystring'
import puppeteer from 'puppeteer'
import { Task, QueueResult } from 'types/amqp'
import { headlessLog } from '../log'
import config from '../config'
import { ErrCode, TaskError, logPrefix, filterObject } from '../utils'

let closeTimer: NodeJS.Timeout | null = null
let globalBrowser: puppeteer.Browser | null = null

const JQUERY_PATH = path.resolve(__dirname, 'jquery-3.5.1.min.js')

const initBrowser = async (): Promise<puppeteer.Browser> => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  if (!globalBrowser) {
    headlessLog.info('launch browser...')
    globalBrowser = await puppeteer.launch({
      args: ['--no-sandbox'],
      headless: config.headless.headless,
      ignoreHTTPSErrors: config.headless.ignoreHTTPSErrors,
    })
  }
  return globalBrowser
}

const idleBrowser = async (): Promise<void> => {
  if (!closeTimer) {
    closeTimer = setTimeout(async () => {
      if (globalBrowser) {
        headlessLog.info('close browser...')
        await globalBrowser.close()
        globalBrowser = null
      }
    }, config.headless.browserCloseTimeout * 1000)
  }
}

const createPage = async (browser: puppeteer.Browser, task: Task): Promise<puppeteer.Page> => {
  const log = logPrefix(headlessLog, task.taskId)
  const onRequest = (request: puppeteer.Request): void => {
    const url = request.url()
    if (task.disableImage && request.resourceType() === 'image') {
      log.debug('request [blocked]:', url)
      request.abort()
      return
    }
    log.debug('request:', url)
    if (!request.isNavigationRequest()) {
      request.continue()
      return
    }
    const headers = {
      ...request.headers(),
      ...task.headers,
    }
    const requestParam: puppeteer.Overrides = {
      headers,
    }
    if (task.method) {
      requestParam.method = task.method
      if (task.method === 'POST' && task.data) {
        requestParam.postData =
          typeof task.data === 'object' ? new URLSearchParams(task.data).toString() : task.data
      }
    }
    log.debug('request params:', requestParam)
    request.continue(requestParam)
  }
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', onRequest)
  page.on('dialog', async (dialog) => {
    log.debug('dismiss dialog')
    await dialog.dismiss()
  })
  if (task.cookies) {
    log.debug('set cookies:', task.cookies)
    await page.setCookie(...task.cookies)
  }
  if (config.headless.userAgent) {
    log.debug('set userAgent:', config.headless.userAgent)
    await page.setUserAgent(config.headless.userAgent)
  }
  if (task.auth) {
    log.debug('set authenticate')
    await page.authenticate({
      username: task.auth.username,
      password: task.auth.password,
    })
  }
  return page
}

const runTask = async (task: Task, customBrowser?: puppeteer.Browser): Promise<QueueResult> => {
  let page: puppeteer.Page | null = null
  const startTime = Date.now()
  const log = logPrefix(headlessLog, task.taskId)
  log.info('---------- RUN TASK ----------')
  try {
    const browser = customBrowser || (await initBrowser())
    const pages = await browser.pages()
    const pagesInfo = await Promise.all(
      pages.map(async (pageItem) => ({
        title: await pageItem.title(),
        url: pageItem.url(),
      }))
    )
    log.info('page opened:', pagesInfo)

    let retryRemain = config.headless.retries
    const loadPage = async (): Promise<[puppeteer.Page, puppeteer.Response]> => {
      log.info('create new page...')
      const newPage = await createPage(browser, task)
      let response: puppeteer.Response | null
      try {
        const url = task.params ? `${task.url}?${querystring.stringify(task.params)}` : task.url
        log.info('loading page...')
        const timeout = (task.timeout || config.headless.defaultLoadTimeout) * 1000
        log.debug('load timeout:', timeout)
        response = await newPage.goto(url, {
          waitUntil: ['domcontentloaded', 'networkidle2'],
          timeout,
        })
        if (!response) {
          throw new TaskError('page is empty')
        }
        if (!response.ok()) {
          throw new TaskError(`page status code is ${response.status()}`)
        }
      } catch (error) {
        log.error('load page error:', error.message)
        await newPage.close()
        log.info('page closed')
        if (retryRemain > 0 && !(error instanceof TaskError)) {
          log.info(`retrying... (${retryRemain} times left)`)
          retryRemain--
          return loadPage()
        }
        throw error
      }
      return [newPage, response]
    }

    let response: puppeteer.Response
    try {
      ;[page, response] = await loadPage()
      log.info('page loaded')
    } catch (error) {
      log.error('page loading failed:', error.message)
      return {
        startTime,
        endTime: Date.now(),
        errorCode: ErrCode.PageLoadError,
        errorMsg: error.message,
      }
    }

    const resultData: QueueResult = {
      startTime,
      endTime: Date.now(),
    }

    const respHeaders = response.headers()
    log.debug('response headers:', respHeaders)
    if (task.requireHeaders) {
      resultData.headers = filterObject(respHeaders, task.requireHeaders)
    }

    log.info('page title:', await page.title())
    log.info('page url:', page.url())

    await page.addScriptTag({ path: JQUERY_PATH })
    log.debug('jQuery loaded')

    try {
      log.info('execute user script...')
      const data = await page.evaluate(task.script)
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
      errorCode: ErrCode.HeadlessError,
      errorMsg: error.message,
    }
  } finally {
    if (page) {
      await page.close()
      log.info('page closed')
    }
    await idleBrowser()
  }
}

export default runTask
