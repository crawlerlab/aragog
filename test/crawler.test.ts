import url from 'url'
import iconv from 'iconv-lite'
import puppeteer from 'puppeteer'
import { Task, QueueResult } from 'types/amqp'
import HttpServer from './utils/http-server'
import mockConfig, { Config } from '../src/config'

jest.mock('../src/config', () => {
  const { default: actualConfig, ...otherExports } =
    jest.requireActual<{ default: Config }>('../src/config')
  const cfg: Partial<Config> = {
    ...actualConfig,
    headless: {
      ...actualConfig.headless,
      browserCloseTimeout: 5 * 60,
      defaultLoadTimeout: 60,
      retries: 3,
      userAgent: 'Test/Headless',
    },
    source: {
      ...actualConfig.source,
      defaultLoadTimeout: 30,
      retries: 3,
      userAgent: 'Test/Source',
    },
  }
  return {
    __esModule: true,
    default: cfg,
    ...otherExports,
  }
})

type RunTaskFn = (task: Task) => Promise<QueueResult>
const PORT = 6060
const SERVER_URL = `http://localhost:${PORT}`
const GUI_MODE = process.env.SHOW_GUI === 'true'

const getRandomID = (): string => Math.random().toString(36).substr(2)
const wait = (time: number): Promise<void> => new Promise((r) => setTimeout(r, time))

let server: HttpServer
let browser: puppeteer.Browser

beforeAll(async () => {
  server = new HttpServer()
  await server.start(PORT)
  browser = await puppeteer.launch({ devtools: GUI_MODE })
  jest.doMock('puppeteer', () => {
    return {
      __esModule: true,
      default: {
        ...puppeteer,
        launch: jest.fn().mockResolvedValue(browser),
      },
    }
  })
})

afterAll(async () => {
  await browser.close()
  await server.close()
})

jest.setTimeout(30000)
describe.each([
  ['headless', mockConfig.headless],
  ['source', mockConfig.source],
])('%s', (n, config) => {
  const name = n as 'headless' | 'source'
  const appName = `${name}-crawler-test`
  let mockedPuppeteer: typeof puppeteer
  let runTask: RunTaskFn

  beforeAll(async () => {
    mockedPuppeteer = (await import('puppeteer')).default
    if (name === 'headless') {
      runTask = (await import('../src/headless')).default
    } else {
      runTask = (await import('../src/source')).default
    }
  })

  it('基础功能', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      res.html(
        `<ul id="list">
          <li>a</li>
          <li>b</li>
          <li>c</li>
        </ul>`
      )
    })

    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `Array.from($('#list').children().map((i,d) => $(d).text()))`,
    })
    expect(result.data).toEqual(['a', 'b', 'c'])
    expect(result.startTime).toEqual(expect.any(Number))
    expect(result.endTime).toEqual(expect.any(Number))
    expect(result.endTime - result.startTime).toBeGreaterThan(0)
    expect(result).not.toHaveProperty('errorCode')
    expect(result).not.toHaveProperty('errorMsg')
  })

  it('弹窗不影响任务进程', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      res.html(
        `<script>
          alert("alert");
          prompt("prompt");
          confirm("confirm");
        </script>
        <div id="data">ok</div>`
      )
    })

    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
    })
    expect(result.data).toEqual('ok')
  })

  it('自动判断HTTP状态码', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.statusCode = 404
      res.html('')
    })
    server.on(path, mockListener)

    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
    })
    expect(mockListener).toHaveBeenCalledTimes(1)
    expect(result.errorCode).toEqual(4001)
    expect(result.errorMsg).toEqual('page status code is 404')
  })

  it('超时重试', async () => {
    const path = getRandomID()
    const mockListener = jest.fn()
    server.on(path, mockListener)

    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
      timeout: 1, // 1s
    })
    expect(mockListener).toHaveBeenCalledTimes(config.retries + 1)
    expect(result.errorCode).toEqual(4001)
    expect(result.errorMsg).toMatch(/timeout of 1000\s?ms exceeded/)
  })

  if (name === 'headless') {
    it('禁用图片', async () => {
      const path = getRandomID()
      // 正常情况
      const html = `
        <div>
          <img src="/${path}/img1.png" />
          <img src="/${path}/img2.jpg" />
          <img src="/${path}/img3.jpeg" />
          <img src="/${path}/img4.gif" />
          <img src="/${path}/img5.webp" />
        </div>`
      const mockListener = jest.fn((req, res) => {
        res.html(html)
      })
      server.on(path, mockListener)

      await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      })
      const expectImages = expect.arrayContaining([
        `/${path}/img1.png`,
        `/${path}/img2.jpg`,
        `/${path}/img3.jpeg`,
        `/${path}/img4.gif`,
        `/${path}/img5.webp`,
      ])
      expect(mockListener.mock.calls.map(([req]) => req.url)).toEqual(expectImages)

      // 禁用图片
      mockListener.mockClear()
      await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
        disableImage: true,
      })
      expect(mockListener.mock.calls.map(([req]) => req.url)).not.toEqual(expectImages)
    })
  }

  if (name === 'source') {
    it('判断网页编码', async () => {
      const path = getRandomID()
      server.on(path, (req, res) => {
        res.setHeader('Content-Type', 'text/html;charset=gbk')
        const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="GBK">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>TestDocument</title>
        </head>
        <body>
          <div id="data">中文编码</div>
        </body>
        </html>
        `
        res.end(iconv.encode(html, 'gbk'))
      })

      const result = await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
      })
      expect(result.data).toEqual('中文编码')
    })

    it('指定网页编码', async () => {
      const path = getRandomID()
      server.on(path, (req, res) => {
        const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="GBK">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>TestDocument</title>
        </head>
        <body>
          <div id="data">中文编码</div>
        </body>
        </html>
        `
        res.end(iconv.encode(html, 'gbk'))
      })

      const resultBad = await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
      })
      expect(resultBad.data).not.toEqual('中文编码')

      const result = await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        encoding: 'gbk',
      })
      expect(result.data).toEqual('中文编码')
    })
  }

  it('POST请求方式', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      let body = ''
      req.on('data', (chunk: string) => {
        body += chunk
      })
      req.on('end', () => {
        res.html(`<div id="data">${body}</div>`)
      })
    })
    // Object
    const objRes = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
      method: 'POST',
      data: {
        a: 'da',
        b: 'db',
      },
    })
    expect(objRes.data).toEqual('a=da&b=db')
    //  String
    const stringRes = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
      method: 'POST',
      data: 'post-data',
    })
    expect(stringRes.data).toEqual('post-data')
  })

  it('HTTP认证', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      const userPass = Buffer.from(
        (req.headers.authorization || '').split(' ')[1] || '',
        'base64'
      ).toString()
      if (userPass === 'user:pass') {
        res.html('<div id="data">auth ok</div>')
      } else {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="nope"' })
        res.html('<div id="data">access denied</div>')
      }
    })

    const resultDenied = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
      auth: {
        username: 'wrong',
        password: 'wrong',
      },
    })
    expect(resultDenied.errorCode).toEqual(4001)
    expect(resultDenied.errorMsg).toEqual('page status code is 401')

    const resultOk = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
      auth: {
        username: 'user',
        password: 'pass',
      },
    })
    expect(resultOk.data).toEqual('auth ok')
  })

  it('URL参数', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      const queryObject = url.parse(req.url, true).query
      res.html(`<div id="data">${JSON.stringify(queryObject)}</div>`)
    })

    const params = {
      a: 'da',
      b: 'db',
    }
    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').text()`,
      params,
    })
    expect(result.data).toEqual(JSON.stringify(params))
  })

  it('自定义UserAgent', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.html('')
    })
    server.on(path, mockListener)

    await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
    })
    expect(mockListener.mock.calls.map(([req]) => req.headers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          'user-agent': config.userAgent,
        }),
      ])
    )
  })

  it('自定义请求头', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.html('')
    })
    server.on(path, mockListener)

    const headers = {
      authorization: `Bearer token`,
      cookie: 'name=value',
      referer: 'https://abc.com/',
    }
    await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
      headers,
    })
    expect(mockListener.mock.calls.map(([req]) => req.headers)).toEqual(
      expect.arrayContaining([expect.objectContaining(headers)])
    )
  })

  it('设置Cookies', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.html('')
    })
    server.on(path, mockListener)

    await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
      cookies: [
        {
          name: 'nck1',
          value: 'vck1',
          domain: `localhost:${PORT}`,
          path: `/${path}`,
          expires: new Date('2021/01/01').valueOf(),
          httpOnly: true,
          secure: false,
        },
        {
          name: 'nck2',
          value: 'vck2',
          domain: `localhost:${PORT}`,
        },
      ],
    })
    expect(mockListener.mock.calls.map(([req]) => req.headers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cookie: 'nck1=vck1; nck2=vck2',
        }),
      ])
    )
  })

  it('获取响应头', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      res.writeHead(200, {
        'Set-Cookie': 'name=value; path=/',
        'Cache-Control': 'public, max-age=2592000',
        Server: 'test-http',
      })
      res.html('')
    })

    const resultAll = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
      requireHeaders: true,
    })
    expect(resultAll.headers).toEqual(
      expect.objectContaining({
        'set-cookie': 'name=value; path=/',
        'cache-control': 'public, max-age=2592000',
        server: 'test-http',
      })
    )

    const resultPart = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: '',
      requireHeaders: ['Cache-Control'],
    })
    expect(resultPart.headers).toEqual({
      'cache-control': 'public, max-age=2592000',
    })
  })

  it('用户脚本异常', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      res.html(`<div id="data">ok</div>`)
    })

    const result = await runTask({
      appName,
      taskId: path,
      url: `${SERVER_URL}/${path}`,
      script: `$('#data').noFun()`,
    })
    expect(result).not.toHaveProperty('data')
    expect(result.errorCode).toEqual(4002)
    expect(result.errorMsg).toMatch('$(...).noFun is not a function')
  })

  if (name === 'headless') {
    it('浏览器闲置时关闭', async () => {
      const path = getRandomID()
      server.on(path, (req, res) => {
        res.html('')
      })

      const CLOSE_TIMEOUT_MS = 5 * 60 * 1000
      const closeSpy = jest.spyOn(browser, 'close').mockResolvedValue()
      const mockedLaunch = mockedPuppeteer.launch as jest.Mock

      jest.useFakeTimers()
      await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      })
      expect(jest.getTimerCount()).toBe(1)
      jest.advanceTimersByTime(CLOSE_TIMEOUT_MS - 1000)
      await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      })
      expect(jest.getTimerCount()).toBe(1)
      jest.advanceTimersByTime(CLOSE_TIMEOUT_MS - 1000)
      expect(browser.close).not.toBeCalled()
      expect(mockedLaunch).toBeCalledTimes(1)

      jest.advanceTimersByTime(CLOSE_TIMEOUT_MS)

      jest.useRealTimers()
      await wait(1000)
      await runTask({
        appName,
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      })
      expect(browser.close).toBeCalledTimes(1)
      expect(mockedLaunch).toBeCalledTimes(2)

      closeSpy.mockRestore()
    })
  }
})
