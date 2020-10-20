export interface Cookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax'
}

export interface QueueItem {
  appName: string
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
  cookies?: Cookie[]
  headers?: { [key: string]: string }
  requireHeaders?: boolean | string[]
  timeout?: number
}

export interface Task extends QueueItem {
  taskId: string
}

export interface QueueResult {
  data?: any // eslint-disable-line
  headers?: { [key: string]: string }
  errorCode?: number
  errorMsg?: string
  startTime: number
  endTime: number
}

export interface AmqpConn {
  hostname: string
  port?: number
  username: string
  password: string
  vhost?: string
}
