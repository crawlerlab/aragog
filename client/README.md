# Aragog Client

[![Build Status](https://img.shields.io/travis/com/crawlerlab/aragog/master?style=flat-square)](https://app.travis-ci.com/github/crawlerlab/aragog)
[![NPM Version](https://img.shields.io/npm/v/aragog-client?style=flat-square)](https://www.npmjs.com/package/aragog-client)
[![License](https://img.shields.io/github/license/crawlerlab/aragog?style=flat-square)](https://github.com/crawlerlab/aragog/blob/master/LICENSE)

Aragog Client 是一个双模式的分布式爬虫框架的 NodeJS 客户端, 用于派发爬虫任务, 并接收抓取结果
需配合 Aragog 服务端使用 ([Github][aragog-github])

## 安装

`yarn add aragog-client` 或 `npm install aragog-client`

## 使用

```js
const aragog = require('aragog-client')

const main = async () => {
  const client = await aragog.connect({
    appName: 'example',
    hostname: 'localhost',
    username: 'admin',
    password: '123456',
  })

  client.addTask('headless', {
    id: '1',
    url: 'http://example.com/',
    script: `$('h1').text()`,
  })

  client.onTaskCompleted((err, res) => {
    if (err) {
      console.error('task error', err)
      return
    }
    console.log(res)
    /**
      output:
      {
        id: '1',
        data: 'Example Domain'
      }
    */
    client.close() // disconnect
  })
}

main().catch((err) => console.error(err))
```

## API

### client = await aragog.connect(ConnectParams, Options?)

```ts
interface ConnectParams {
  appName: string // 客户端唯一标识
  hostname: string // RabbitMQ 服务器地址
  username: string // RabbitMQ 用户名
  password: string // RabbitMQ 密码
  port?: number // RabbitMQ 端口
  vhost?: string // RabbitMQ vhost
}
```

- **appName:** 每个客户端必须不唯一, 用于区分消息队列

```ts
interface Options {
  ssl?: boolean
  durable?: boolean // default: false
  exchangeName?: string // default: aragog_exchange
}
```

- **ssl:** RabbitMQ 是否使用 ssl 连接 (默认值: false, 影响远程管理 API 的调用方式)
- **durable:** 是否持久化结果队列, 如果为 true, 则创建爬虫任务后, 即使断开客户端连接, 在下次连接时仍然会接收上次的处理结果
- **exchangeName:** 自定义 RabbitMQ exchange

### client.addTask(TaskType, TaskData)

```ts
enum TaskType {
  Headless = 'headless', // 无头浏览器模式 (puppeteer)
  Source = 'source', // HTTP请求模式 (axios)
}
```

```ts
interface TaskData {
  id: string
  priority?: number
  url: string
  script: string
  disableImage?: boolean
  encoding?: string
  method?: 'GET' | 'POST'
  auth?: {
    username: string
    password: string
  }
  data?: { [key: string]: string } | string
  params?: { [key: string]: string }
  cookies?: {
    name: string
    value: string
    domain?: string
    path?: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax'
  }[]
  headers?: { [key: string]: string }
  requireHeaders?: boolean | string[]
  timeout?: number
}
```

- **id:** 指定任务 ID, 在任务完成时返回对应的 ID 及结果
- **priority:** 任务优先级, 0~10 之间的值 (0: 最低优先级, 10: 最高优先级), 当任务排队时, 优先级高的任务优先处理
- **url:** 指定抓取的网页 URL (包含协议部分)
- **script:**

  网页加载完成后, 运行的 jQuery 脚本, 返回的任何值将作为结果(data)返回  
  注: headless 模式使用 jQuery v3.5.1, 且支持异步函数和 DOM API; source 模式使用 [cheerio][cheerio-github], API 可能存在差异  
  如编写复杂函数, 可使用自执行函数

  ```js
  ;(() => {
    const text = $('h1').text()
    return 'h1' + text
  })()
  ```

- **disableImage:** 仅 headless 模式可用, 是否禁用所有图片 (默认值: false)
- **encoding:** 仅 source 模式可用, 指定网页编码 (默认使用响应头的 content-type 自动判断或 utf-8)
- **method:** 请求方法, 支持 GET 或 POST, GET 方法使用 params 传参, POST 方法使用 data 传参 (默认值: GET)
- **auth:** 使用基础 HTTP 认证, 例: `{ username: 'admin', password: '123456' }`
- **data:**

  POST 数据, 支持 FormData, 字符串或 JSON 等  
  FormData: `{ a: '1', b: '2' }`  
  任意字符串: `a=1&b=2`  
  JSON 数据: `JSON.stringify({ a: '1', b: '2' })`

- **params:** GET 参数, 例: `{ a: '1', b: '2' }`
- **cookies:** 随请求发送的 Cookies 数据, 例: `[{ name: 'n1', value: 'v1' }, { name: 'n2', value: 'v2' }]`
- **headers:** 自定义请求头, 例: `{ Authorization: 'Bearer token' }`
- **requireHeaders:**

  需要获取的响应头, 默认返回结果不包含响应头信息 (headers)  
  `false`: 默认值, 不返回响应头信息  
  `true`: 获取所有响应头
  `['set-cookie', 'content-type']`: 获取网页的 Cookies 和 Content Type 字段

- **timeout:** 页面加载超时时间, 默认使用服务端配置 (单位: 秒)

### client.onTaskCompleted(callback: (ResultData, Error) => void)

```ts
interface ResultData {
  data?: any // script 的执行结果, 仅任务成功完成时存在
  headers?: { [key: string]: string } // 响应头信息 (受 requireHeaders 控制)
  errorCode?: number // 错误码
  errorMsg?: string // 错误详情
  startTime: number // 任务开始时间戳 (服务端时间)
  endTime: number // 任务完成时间戳 (服务端时间)
}
```

当存在 Error 参数时, ResultData 中包含错误信息  
errorCode:

- 4000: 请求参数不正确
- 4001: 页面加载失败
- 4002: 用户脚本执行失败
- 5000: headless 模式, 服务端错误
- 5010: source 模式, 服务端错误

### client.close(): Promise

关闭客户端连接, 再次使用时需再次调用 connect 方法创建客户端

### client.getServerInfo(): Promise

具体参考 [RabbitMQ HTTP API][rabbitmq-api] 中的 `/api/consumers/vhost` 部分

### client.getQueueInfo(TaskType): Promise

具体参考 [RabbitMQ HTTP API][rabbitmq-api] 中的 `/api/queues/vhost/name` 部分

## 许可证

MIT

[aragog-github]: https://github.com/crawlerlab/aragog
[cheerio-github]: https://github.com/cheeriojs/cheerio
[rabbitmq-api]: https://rawcdn.githack.com/rabbitmq/rabbitmq-management/v3.8.5/priv/www/api/index.html
