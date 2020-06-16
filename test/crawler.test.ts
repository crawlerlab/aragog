import url from 'url'
import iconv from 'iconv-lite'
import puppeteer from 'puppeteer'
import HttpServer from './utils/http-server'
import mockConfig, { Config } from '../src/config'
import runHeadlessTask from '../src/headless'
import runSourceTask from '../src/source'

const PORT = 6060
const SERVER_URL = `http://localhost:${PORT}`
const GUI_MODE = process.env.SHOW_GUI === 'true'

const getRandomID = (): string => Math.random().toString(36).substr(2)

jest.mock('../src/config', () => {
  const { default: actualConfig, ...otherExports } = jest.requireActual('../src/config')
  const cfg: Partial<Config> = {
    ...actualConfig,
    headless: {
      browserCloseTimeout: 5 * 60,
      defaultLoadTimeout: 60,
      retries: 3,
      userAgent: 'Test/Headless',
    },
    source: {
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

jest.setTimeout(30000)
describe.each([
  ['headless', runHeadlessTask, mockConfig.headless],
  ['source', runSourceTask, mockConfig.source],
])('%s', (name, runTask, config) => {
  let server: HttpServer
  let browser: puppeteer.Browser

  beforeAll(async () => {
    server = new HttpServer()
    await server.start(PORT)
    browser = await puppeteer.launch({ devtools: GUI_MODE })
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

    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `Array.from($('#list').children().map((i,d) => $(d).text()))`,
      },
      browser
    )
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

    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
      },
      browser
    )
    expect(result.data).toEqual('ok')
  })

  it('自动判断HTTP状态码', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.statusCode = 404
      res.html('')
    })
    server.on(path, mockListener)

    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      },
      browser
    )
    expect(mockListener).toHaveBeenCalledTimes(1)
    expect(result.errorCode).toEqual(4001)
    expect(result.errorMsg).toEqual('page status code is 404')
  })

  it('超时重试', async () => {
    const path = getRandomID()
    const mockListener = jest.fn()
    server.on(path, mockListener)

    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
        timeout: 1, // 1s
      },
      browser
    )
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

      await runTask(
        {
          taskId: path,
          url: `${SERVER_URL}/${path}`,
          script: '',
        },
        browser
      )
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
      await runTask(
        {
          taskId: path,
          url: `${SERVER_URL}/${path}`,
          script: '',
          disableImage: true,
        },
        browser
      )
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

      const result = await runTask(
        {
          taskId: path,
          url: `${SERVER_URL}/${path}`,
          script: `$('#data').text()`,
        },
        browser
      )
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

      const resultBad = await runTask(
        {
          taskId: path,
          url: `${SERVER_URL}/${path}`,
          script: `$('#data').text()`,
        },
        browser
      )
      expect(resultBad.data).not.toEqual('中文编码')

      const result = await runTask(
        {
          taskId: path,
          url: `${SERVER_URL}/${path}`,
          script: `$('#data').text()`,
          encoding: 'gbk',
        },
        browser
      )
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
    const objRes = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        method: 'POST',
        data: {
          a: 'da',
          b: 'db',
        },
      },
      browser
    )
    expect(objRes.data).toEqual('a=da&b=db')
    //  String
    const stringRes = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        method: 'POST',
        data: 'post-data',
      },
      browser
    )
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

    const resultDenied = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        auth: {
          username: 'wrong',
          password: 'wrong',
        },
      },
      browser
    )
    expect(resultDenied.errorCode).toEqual(4001)
    expect(resultDenied.errorMsg).toEqual('page status code is 401')

    const resultOk = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        auth: {
          username: 'user',
          password: 'pass',
        },
      },
      browser
    )
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
    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').text()`,
        params,
      },
      browser
    )
    expect(result.data).toEqual(JSON.stringify(params))
  })

  it('自定义UserAgent', async () => {
    const path = getRandomID()
    const mockListener = jest.fn((req, res) => {
      res.html('')
    })
    server.on(path, mockListener)

    await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
      },
      browser
    )
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
    await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
        headers,
      },
      browser
    )
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

    await runTask(
      {
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
      },
      browser
    )
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

    const resultAll = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
        requireHeaders: true,
      },
      browser
    )
    expect(resultAll.headers).toEqual(
      expect.objectContaining({
        'set-cookie': 'name=value; path=/',
        'cache-control': 'public, max-age=2592000',
        server: 'test-http',
      })
    )

    const resultPart = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: '',
        requireHeaders: ['set-cookie', 'Cache-Control'],
      },
      browser
    )
    expect(resultPart.headers).toEqual({
      'set-cookie': 'name=value; path=/',
      'cache-control': 'public, max-age=2592000',
    })
  })

  it('用户脚本异常', async () => {
    const path = getRandomID()
    server.on(path, (req, res) => {
      res.html(`<div id="data">ok</div>`)
    })

    const result = await runTask(
      {
        taskId: path,
        url: `${SERVER_URL}/${path}`,
        script: `$('#data').noFun()`,
      },
      browser
    )
    expect(result).not.toHaveProperty('data')
    expect(result.errorCode).toEqual(4002)
    expect(result.errorMsg).toMatch('$(...).noFun is not a function')
  })

  afterAll(async () => {
    await server.close()
    await browser.close()
  })
})
